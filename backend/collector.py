"""TryWise trial-candidate collector.

Batch collector that turns allowlisted public sources (official offer pages,
RSS/Atom feeds, deal sites, forums, podcast pages) plus user submissions into
ranked trial candidates.

Design principles:
  * Standard library only -- no third-party packages required.
  * SSRF-safe: every fetched URL is validated, hostnames are resolved, and
    connections go only to global (public) IP addresses. Redirects are
    re-validated hop by hop.
  * Polite: robots.txt is honored per host (Disallow + Crawl-delay), with a
    per-host minimum interval between requests and conditional requests
    (ETag / If-Modified-Since) so scheduled runs stay cheap.
  * Stateful: data/state.json remembers every candidate URL, so each run can
    report what is new, updated, or gone instead of re-alerting everything.
  * Honest: fetch problems (JS-only pages, blocked robots, non-HTML content)
    are recorded on the source result instead of silently yielding nothing.

Outputs (under backend/data/):
  * trials.generated.json -- ranked candidates, schema_version 2 envelope.
  * alerts.generated.md  -- digest of new / updated / gone candidates + errors.
  * state.json            -- run state for diffing and conditional requests.

Usage:
  python3 collector.py [--sources PATH] [--data-dir PATH] [--quiet]

Environment:
  TRYWISE_CONTACT -- contact email used in the User-Agent header.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socket
import ssl
import sys
import time
import zlib
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from ipaddress import ip_address
from pathlib import Path
from urllib.error import URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE_FILE = ROOT / "sources.json"
DEFAULT_DATA_DIR = ROOT / "data"
SOURCE_FILE = DEFAULT_SOURCE_FILE
SUBMISSION_FILE = ROOT / "submissions.json"

SCHEMA_VERSION = 2

# ---------------------------------------------------------------------------
# Tunables (module constants so scheduled runs behave identically everywhere)
# ---------------------------------------------------------------------------
CONTACT_EMAIL = os.environ.get("TRYWISE_CONTACT", "sohan.botke@gmail.com")
USER_AGENT = f"TryWiseBot/0.1 (+mailto:{CONTACT_EMAIL})"
REQUEST_TIMEOUT = 12            # seconds for connect + read
MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 500_000
MIN_HOST_INTERVAL = 5.0         # polite floor between requests to one host
VERIFY_BUDGET = 40              # max candidate-link verifications per run
ROBOTS_TTL = 3600               # seconds to cache a host's robots.txt

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igshid",
}

ALLOWED_CONTENT_TYPES = (
    "text/html",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml",
    "application/xml",
    "text/xml",
    "text/rss",
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TrialCandidate:
    source_id: str
    source_label: str
    source_type: str
    title: str
    url: str
    source_url: str
    categories: list[str]
    confidence: str            # high | medium | candidate | community-verified
    score: int                 # 0..100, deterministic
    signals: list[str]         # matched signal phrases that caused discovery
    link_status: str           # ok | broken | not_checked | budget_exhausted | blocked
    landing_match: str         # trial-page | promo-page | reachable-no-trial-signals | not_checked | ...
    trial_days: int | None = None
    price_hint: str | None = None
    eligibility_hint: str | None = None
    status: str = "new"        # new | updated | unchanged | gone
    first_seen: str = ""
    last_seen: str = ""
    discovered_at: str = ""


@dataclass
class FetchResult:
    url: str
    ok: bool
    status: int = 0
    content_type: str = ""
    text: str = ""
    etag: str = ""
    last_modified: str = ""
    not_modified: bool = False
    quality: str = "unknown"   # ok | js_required | empty | non_html
    robots: str = "unknown"    # allowed | blocked | unreachable
    error: str = ""


@dataclass(frozen=True)
class UserSubmission:
    title: str
    url: str
    categories: list[str]
    submitted_by: str
    upvotes: int = 0
    saves: int = 0
    reports: int = 0
    verified: bool = False


# ---------------------------------------------------------------------------
# URL safety (SSRF protection)
# ---------------------------------------------------------------------------
def validate_public_url(url: str):
    """Return (parsed, ip) for an http(s) URL whose host resolves to a public IP.

    Raises URLError for anything else: non-http schemes, localhost, private /
    reserved addresses, unresolvable hosts.
    """
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise URLError("only http and https sources are allowed")
    if not parsed.hostname:
        raise URLError("source URL must include a hostname")

    hostname = parsed.hostname.strip().lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise URLError("local hostnames are not allowed")

    resolved = resolve_public_ips(hostname)
    return parsed, resolved[0]


def resolve_public_ips(hostname: str):
    try:
        addresses = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise URLError(f"could not resolve source hostname: {hostname}") from exc

    resolved = []
    for address in addresses:
        ip = ip_address(address[4][0])
        if not ip.is_global:
            raise URLError(f"source resolved to non-global address: {ip}")
        resolved.append(ip)
    if not resolved:
        raise URLError("source hostname did not resolve to an address")
    return resolved


def canonical_url(url: str) -> str:
    """Normalize a URL for dedup: lowercase host, drop fragment + trackers."""
    parsed = urlparse(url)
    query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True)
             if k.lower() not in TRACKING_PARAMS]
    cleaned = parsed._replace(
        scheme=parsed.scheme.lower(),
        netloc=parsed.netloc.lower(),
        fragment="",
        query=urlencode(query),
    )
    return cleaned.geturl()


# ---------------------------------------------------------------------------
# HTTP layer (stdlib sockets, SSRF-pinned, with real decoding)
# ---------------------------------------------------------------------------
def http_get(url: str, *, timeout: int = REQUEST_TIMEOUT,
             extra_headers: dict[str, str] | None = None,
             redirects_remaining: int = MAX_REDIRECTS) -> tuple[int, dict[str, str], bytes]:
    """GET a validated public URL. Returns (status, headers, body).

    Handles redirects (re-validating each hop), chunked transfer encoding, and
    gzip/deflate content encodings. Sends `Accept-Encoding: identity` to avoid
    compressed bodies, but still decodes them if a server ignores that.
    """
    parsed, resolved_ip = validate_public_url(url)
    status, headers, raw = http_get_once(parsed, resolved_ip, timeout, extra_headers or {})
    if status in {301, 302, 303, 307, 308}:
        if redirects_remaining < 1:
            raise URLError("too many redirects")
        location = headers.get("location")
        if not location:
            raise URLError("redirect response did not include Location")
        return http_get(urljoin(url, location), timeout=timeout,
                        extra_headers=extra_headers,
                        redirects_remaining=redirects_remaining - 1)
    if status < 200 or status >= 300:
        raise URLError(f"source returned HTTP {status}")
    return status, headers, raw


def http_get_once(parsed, resolved_ip, timeout: int,
                  extra_headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"

    with socket.create_connection((str(resolved_ip), port), timeout=timeout) as sock:
        connection = sock
        if parsed.scheme == "https":
            context = ssl.create_default_context()
            connection = context.wrap_socket(sock, server_hostname=parsed.hostname)

        header_lines = [
            f"GET {path} HTTP/1.1",
            f"Host: {parsed.hostname}",
            f"User-Agent: {USER_AGENT}",
            "Accept: text/html, application/rss+xml, application/atom+xml,"
            " application/xml;q=0.9, */*;q=0.8",
            "Accept-Encoding: identity",
            "Connection: close",
        ]
        for name, value in extra_headers.items():
            header_lines.append(f"{name}: {value}")
        request = ("\r\n".join(header_lines) + "\r\n\r\n").encode("ascii")
        connection.sendall(request)
        with connection.makefile("rb") as response:
            status_line = response.readline(8192).decode("iso-8859-1").strip()
            status = parse_status(status_line)
            headers = read_headers(response)
            raw = response.read(MAX_RESPONSE_BYTES + 1)

    body = raw[:MAX_RESPONSE_BYTES]
    if headers.get("transfer-encoding", "").lower() == "chunked":
        body = decode_chunked(body)
    encoding = headers.get("content-encoding", "").lower()
    if encoding == "gzip":
        body = gunzip(body)
    elif encoding == "deflate":
        body = inflate(body)
    return status, headers, body


def parse_status(status_line: str) -> int:
    parts = status_line.split(" ", 2)
    if len(parts) < 2 or not parts[1].isdigit():
        raise URLError(f"invalid HTTP response: {status_line}")
    return int(parts[1])


def read_headers(response) -> dict[str, str]:
    headers: dict[str, str] = {}
    while True:
        line = response.readline(8192).decode("iso-8859-1")
        if line in {"\r\n", "\n", ""}:
            return headers
        name, _, value = line.partition(":")
        if name and value:
            # First occurrence wins for single-value headers we care about.
            headers.setdefault(name.strip().lower(), value.strip())
    return headers


def decode_chunked(body: bytes) -> bytes:
    out = bytearray()
    i = 0
    while True:
        j = body.find(b"\r\n", i)
        if j == -1:
            break
        line = body[i:j].split(b";")[0].strip()
        try:
            size = int(line, 16)
        except ValueError:
            break
        i = j + 2
        if size == 0:
            break
        out += body[i:i + size]
        i += size + 2  # skip trailing CRLF after the chunk
    return bytes(out)


def gunzip(body: bytes) -> bytes:
    try:
        return zlib.decompress(body, 16 + zlib.MAX_WBITS)
    except zlib.error:
        return body


def inflate(body: bytes) -> bytes:
    try:
        return zlib.decompress(body)
    except zlib.error:
        try:
            return zlib.decompress(body, -zlib.MAX_WBITS)
        except zlib.error:
            return body


def content_type_ok(content_type: str) -> bool:
    mime = content_type.split(";")[0].strip().lower()
    return mime in ALLOWED_CONTENT_TYPES


def looks_like_feed(text: str) -> bool:
    head = text.lstrip()[:200].lower()
    return head.startswith("<rss") or head.startswith("<?xml") and "<rss" in text[:2000].lower() \
        or "<feed" in text[:2000].lower()


def classify_fetch_quality(text: str, content_type: str) -> str:
    if not content_type_ok(content_type):
        return "non_html"
    stripped = strip_tags(text)
    lowered = text.lower()
    text_len = len(re.sub(r"\s+", "", stripped))
    has_app_shell = any(marker in lowered for marker in (
        'id="root"', 'id="app"', "__next_data__", "ng-app", 'data-reactroot',
    ))
    js_required_phrases = (
        "javascript is required", "please enable javascript",
        "enable javascript to", "requires javascript",
    )
    # Check JS-shell first: a page whose only copy is "enable JavaScript"
    # is js-required, not merely empty.
    if text_len < 400 and (has_app_shell
                           or any(p in lowered for p in js_required_phrases)):
        return "js_required"
    if len(stripped) < 40:
        return "empty"
    return "ok"


# ---------------------------------------------------------------------------
# robots.txt compliance + politeness
# ---------------------------------------------------------------------------
class RobotsChecker:
    """Minimal robots.txt client: honors Disallow for our UA (and `*`) and
    Crawl-delay. Rules are cached per host for ROBOTS_TTL seconds."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, list[tuple[str, str]], float | None]] = {}

    def check(self, url: str) -> tuple[bool, float | None, str]:
        """Return (allowed, crawl_delay_seconds, note)."""
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        key = f"{host}:{port}"
        now = time.time()
        cached = self._cache.get(key)
        if cached and now - cached[0] < ROBOTS_TTL:
            rules, delay = cached[1], cached[2]
        else:
            rules, delay = self._fetch_rules(parsed)
            self._cache[key] = (now, rules, delay)
        path = parsed.path or "/"
        for pattern, _ in rules:
            if path.startswith(pattern):
                return False, delay, f"disallowed by robots.txt ({pattern})"
        return True, delay, "allowed"

    def _fetch_rules(self, parsed) -> tuple[list[tuple[str, str]], float | None]:
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        try:
            status, _headers, raw = http_get(robots_url)
        except URLError:
            return [], None  # unreachable robots.txt -> treat as no rules
        if status != 200:
            return [], None
        return parse_robots(raw.decode("utf-8", errors="replace"))


def parse_robots(text: str) -> tuple[list[tuple[str, str]], float | None]:
    """Parse robots.txt into ([(path_prefix, agent)], crawl_delay). Only the
    group for our UA name (trywisebot) or `*` is honored. A new User-agent
    line after any rule starts a new group (agents don't leak across groups)."""
    rules: list[tuple[str, str]] = []
    crawl_delay: float | None = None
    group_agents: list[str] = []
    group_applies = False
    seen_rule = False
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        field, _, value = line.partition(":")
        field = field.strip().lower()
        value = value.strip()
        if field == "user-agent":
            if seen_rule:
                group_agents = []
                group_applies = False
                seen_rule = False
            agent = value.lower()
            group_agents.append(agent)
            if agent in {"*", "trywisebot"}:
                group_applies = True
        elif field == "disallow":
            seen_rule = True
            if group_applies and value:
                rules.append((value, "disallow"))
        elif field == "crawl-delay":
            seen_rule = True
            if group_applies:
                try:
                    crawl_delay = float(value)
                except ValueError:
                    pass
        elif field in {"allow", "sitemap"}:
            seen_rule = True
    return rules, crawl_delay


class PoliteFetcher:
    """Orchestrates robots checks, per-host intervals, and conditional GETs."""

    def __init__(self, robots: RobotsChecker | None = None) -> None:
        self.robots = robots or RobotsChecker()
        self._last_hit: dict[str, float] = {}

    def _wait_turn(self, url: str, crawl_delay: float | None) -> None:
        host = (urlparse(url).hostname or "").lower()
        interval = max(MIN_HOST_INTERVAL, crawl_delay or 0)
        now = time.time()
        last = self._last_hit.get(host, 0)
        wait = interval - (now - last)
        if wait > 0:
            time.sleep(wait)
        self._last_hit[host] = time.time()


def fetch_with_304(url: str, fetcher: PoliteFetcher,
                   state_entry: dict | None) -> FetchResult:
    """Wrapper that converts an HTTP 304 into FetchResult(not_modified=True)."""
    # We do the conditional dance manually so a 304 isn't an error.
    probe = FetchResult(url=url, ok=False)
    try:
        validate_public_url(url)
    except URLError as exc:
        probe.error = f"unsafe url: {exc}"
        return probe
    allowed, crawl_delay, note = fetcher.robots.check(url)
    probe.robots = "allowed" if allowed else "blocked"
    if not allowed:
        probe.error = note
        return probe
    fetcher._wait_turn(url, crawl_delay)
    headers: dict[str, str] = {}
    if state_entry:
        if state_entry.get("etag"):
            headers["If-None-Match"] = state_entry["etag"]
        if state_entry.get("last_modified"):
            headers["If-Modified-Since"] = state_entry["last_modified"]
    try:
        status, resp_headers, body = http_get(url, extra_headers=headers)
    except URLError as exc:
        if "HTTP 304" in str(exc):
            probe.not_modified = True
            probe.ok = True
            probe.robots = "allowed"
            return probe
        probe.error = str(exc)
        return probe
    probe.status = status
    probe.content_type = resp_headers.get("content-type", "")
    probe.etag = resp_headers.get("etag", "")
    probe.last_modified = resp_headers.get("last-modified", "")
    text = body.decode("utf-8", errors="replace")
    probe.text = text
    probe.quality = classify_fetch_quality(text, probe.content_type)
    probe.ok = probe.quality == "ok"
    if not probe.ok:
        probe.error = f"fetch quality: {probe.quality}"
    return probe


# ---------------------------------------------------------------------------
# HTML parsing: boilerplate stripping + link extraction
# ---------------------------------------------------------------------------
BOILERPLATE_TAGS = {"script", "style", "nav", "header", "footer", "aside",
                    "noscript", "form", "svg"}


def strip_boilerplate(html: str) -> str:
    """Remove script/style/nav/header/footer/aside blocks, then strip tags."""
    text = html
    for tag in BOILERPLATE_TAGS:
        text = re.sub(rf"<{tag}[\s\S]*?</{tag}\s*>", " ", text, flags=re.IGNORECASE)
    return strip_tags(text)


def strip_tags(text: str) -> str:
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


class LinkExtractor(HTMLParser):
    """Collect (label, href) for anchors, plus nearest heading context."""

    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []
        self._last_heading: str = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h1", "h2", "h3"}:
            self._heading_tag: str | None = tag
            self._heading_text: list[str] = []
            return
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href and not href.strip().lower().startswith(("javascript:", "mailto:", "tel:")):
            self._href = urljoin(self.base_url, href)
            self._text = []

    def handle_data(self, data: str) -> None:
        if getattr(self, "_heading_tag", None):
            self._heading_text.append(data)
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if getattr(self, "_heading_tag", None) == tag:
            heading = re.sub(r"\s+", " ", " ".join(self._heading_text)).strip()
            if heading:
                self._last_heading = heading
            self._heading_tag = None
            return
        if tag != "a" or not self._href:
            return
        label = re.sub(r"\s+", " ", " ".join(self._text)).strip()
        if label:
            context = f"{self._last_heading} {label}".strip()
            self.links.append((context, self._href))
        self._href = None
        self._text = []


def extract_links(base_url: str, html: str) -> list[tuple[str, str]]:
    parser = LinkExtractor(base_url)
    parser.feed(html)
    return parser.links


# ---------------------------------------------------------------------------
# RSS / Atom parsing
# ---------------------------------------------------------------------------
def parse_feed_items(text: str) -> list[dict[str, str]]:
    """Parse RSS 2.0 or Atom feeds into [{title, link, summary, published}]."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return []
    items: list[dict[str, str]] = []

    def text_of(elem, names: list[str]) -> str:
        for name in names:
            child = elem.find(name)
            if child is not None and child.text:
                return child.text.strip()
            # namespaced atom variant
            child = elem.find(f"{{http://www.w3.org/2005/Atom}}{name}")
            if child is not None and child.text:
                return child.text.strip()
        return ""

    tag = root.tag.lower()
    if tag.endswith("rss") or root.find("channel") is not None:
        for item in root.iter("item"):
            link = text_of(item, ["link", "guid"])
            items.append({
                "title": text_of(item, ["title"]),
                "link": link,
                "summary": text_of(item, ["description"]),
                "published": text_of(item, ["pubDate"]),
            })
    elif tag.endswith("feed"):
        ns = "{http://www.w3.org/2005/Atom}"
        for entry in root.iter(f"{ns}entry"):
            link = ""
            link_el = entry.find(f"{ns}link")
            if link_el is not None:
                link = (link_el.get("href") or "").strip()
            summary_el = entry.find(f"{ns}summary")
            content_el = entry.find(f"{ns}content")
            summary = ""
            if summary_el is not None and summary_el.text:
                summary = summary_el.text.strip()
            elif content_el is not None and content_el.text:
                summary = content_el.text.strip()
            title_el = entry.find(f"{ns}title")
            published_el = entry.find(f"{ns}published") or entry.find(f"{ns}updated")
            items.append({
                "title": title_el.text.strip() if title_el is not None and title_el.text else "",
                "link": link,
                "summary": strip_tags(summary),
                "published": published_el.text.strip()
                if published_el is not None and published_el.text else "",
            })
    return [i for i in items if i["title"] or i["link"]]


# ---------------------------------------------------------------------------
# Signal engine: weighted phrases, negative signals, structured extraction
# ---------------------------------------------------------------------------
# Positive signals: (phrase, weight). Weights reflect how strongly the phrase
# indicates a real trial / intro offer rather than incidental copy.
POSITIVE_SIGNALS: tuple[tuple[str, int], ...] = (
    ("start your free trial", 30),
    ("start a free trial", 30),
    ("free trial", 25),
    ("try free for", 22),
    ("first month free", 25),
    ("first year free", 22),
    ("free for 30 days", 20),
    ("intro offer", 20),
    ("introductory offer", 20),
    ("intro pricing", 18),
    ("special intro", 14),
    ("free for", 10),
    ("promo code", 12),
    ("coupon code", 10),
    ("promo", 6),
    ("limited-time", 8),
    ("limited time", 8),
    ("cancel anytime", 10),
    ("no credit card required", 12),
    ("money-back guarantee", 12),
    ("free plan", 10),
    ("free tier", 10),
    ("freemium", 6),
    ("trial period", 12),
    ("risk-free", 10),
    ("on the house", 8),
    ("first box", 10),
    ("first order", 8),
)

# Negative signals: phrases that mean the offer is dead, irrelevant, or
# adversarial (sponsored junk). Strongly penalized.
NEGATIVE_SIGNALS: tuple[tuple[str, int], ...] = (
    ("trial has ended", -50),
    ("offer has ended", -50),
    ("promotion has ended", -40),
    ("no longer available", -50),
    ("offer expired", -40),
    ("expired", -25),
    ("discontinued", -30),
    ("this deal is dead", -50),
    ("deal is dead", -40),
    ("out of stock", -20),
    ("sponsored", -8),
    ("advertisement", -8),
)

MAX_SIGNAL_WEIGHT = 60  # cap total positive contribution so one page of
                        # repeated nav copy can't dominate the score


def matched_signals(text: str) -> list[str]:
    """Return positive signal phrases present in text (longest match wins for
    overlapping phrases, e.g. 'start your free trial' beats 'free trial')."""
    lowered = text.lower()
    hits: list[str] = []
    for phrase, _weight in POSITIVE_SIGNALS:
        if phrase in lowered:
            hits.append(phrase)
    # Drop phrases fully contained in a longer hit to avoid double counting.
    pruned = [p for p in hits
              if not any(other != p and p in other for other in hits)]
    return pruned


def matched_negative_signals(text: str) -> list[str]:
    lowered = text.lower()
    return [phrase for phrase, _ in NEGATIVE_SIGNALS if phrase in lowered]


def signal_weight(phrase: str) -> int:
    for candidate, weight in POSITIVE_SIGNALS:
        if candidate == phrase:
            return weight
    return 0


TRIAL_DAYS_PATTERNS = (
    re.compile(r"(\d{1,3})\s*-\s*day\s+(free\s+)?trial", re.IGNORECASE),
    re.compile(r"free\s+trial\s+for\s+(\d{1,3})\s+days?", re.IGNORECASE),
    re.compile(r"try\s+free\s+for\s+(\d{1,3})\s+days?", re.IGNORECASE),
    re.compile(r"(\d{1,3})\s+days?\s+free", re.IGNORECASE),
    re.compile(r"(\d{1,3})\s*-\s*month\s+(free\s+)?trial", re.IGNORECASE),
    re.compile(r"free\s+for\s+(\d{1,3})\s+months?", re.IGNORECASE),
)


def extract_trial_days(text: str) -> int | None:
    """Best-effort trial length in days, e.g. '30-day free trial' -> 30."""
    for pattern in TRIAL_DAYS_PATTERNS:
        match = pattern.search(text)
        if match:
            value = int(match.group(1))
            if "month" in pattern.pattern:
                value *= 30
            if 1 <= value <= 365:
                return value
    return None


PRICE_PATTERNS = (
    # "$9.99/month" or "$9.99 / mo"
    re.compile(r"\$\s?(\d{1,4}(?:\.\d{1,2})?)\s*/\s*(month|mo)\b", re.IGNORECASE),
    # "then $9.99/month"
    re.compile(r"then\s+\$\s?(\d{1,4}(?:\.\d{1,2})?)", re.IGNORECASE),
    # "first month $1"
    re.compile(r"first\s+month\s+\$\s?(\d{1,4}(?:\.\d{1,2})?)", re.IGNORECASE),
)


def extract_price_hint(text: str) -> str | None:
    """Best-effort post-trial price, e.g. '$9.99/mo'."""
    for pattern in PRICE_PATTERNS:
        match = pattern.search(text)
        if match:
            amount = match.group(1)
            return f"${amount}/mo"
    return None


ELIGIBILITY_PHRASES = (
    "new customers",
    "new users",
    "new subscribers",
    "new members",
    "first-time customers",
    "students",
    "existing customers",  # notable: offer is NOT for new users
)


def extract_eligibility_hint(text: str) -> str | None:
    lowered = text.lower()
    for phrase in ELIGIBILITY_PHRASES:
        if phrase in lowered:
            return phrase
    return None


SOURCE_TYPE_BASE = {
    "official": 30,
    "rss": 18,
    "newsletter": 18,
    "deal-site": 18,
    "forum": 10,
    "podcast": 10,
    "submission": 0,
}


def score_signals(signals: list[str], negative: list[str]) -> int:
    positive = min(sum(signal_weight(s) for s in signals), MAX_SIGNAL_WEIGHT)
    penalty = sum(weight for phrase, weight in NEGATIVE_SIGNALS if phrase in negative)
    return positive + penalty


def score_candidate(source: dict, url: str, signals: list[str],
                    negative: list[str] | None = None,
                    landing_match: str = "not_checked") -> int:
    """Deterministic 0..100 quality score. Documented, not magic."""
    score = SOURCE_TYPE_BASE.get(source.get("type", ""), 5)
    score += score_signals(signals, negative or [])
    if urlparse(source.get("url", "")).netloc == urlparse(url).netloc:
        score += 12  # same-domain links are usually the real offer page
    if landing_match == "trial-page":
        score += 15
    elif landing_match == "promo-page":
        score += 6
    return max(0, min(100, score))


def source_confidence(source: dict, url: str) -> str:
    parsed_source = urlparse(source.get("url", ""))
    parsed_candidate = urlparse(url)
    allowed_domains = set(source.get("allowed_domains", []))
    same_domain = parsed_source.netloc == parsed_candidate.netloc
    explicitly_allowed = parsed_candidate.netloc in allowed_domains
    if source.get("type") == "official" and (same_domain or explicitly_allowed):
        return "high"
    if same_domain:
        return "high"
    if source.get("type") in {"rss", "newsletter", "deal-site"}:
        return "medium"
    return "candidate"


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\s+[|•]\s+", text)
            if part.strip()]


def candidate_content_hash(title: str, signals: list[str],
                           trial_days: int | None, price_hint: str | None) -> str:
    payload = "|".join([title, ",".join(sorted(signals)),
                        str(trial_days or ""), price_hint or ""])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Link verification (budgeted)
# ---------------------------------------------------------------------------
class LinkVerifier:
    """Verifies candidate landing pages within a per-run request budget."""

    def __init__(self, fetcher: PoliteFetcher, budget: int = VERIFY_BUDGET) -> None:
        self.fetcher = fetcher
        self.budget = budget
        self.used = 0

    def check(self, url: str) -> tuple[str, str]:
        try:
            validate_public_url(url)
        except URLError:
            return "blocked", "unsafe-url"
        if self.used >= self.budget:
            return "budget_exhausted", "not_checked"
        self.used += 1
        result = fetch_with_304(url, self.fetcher, None)
        if not result.ok and not result.not_modified:
            return "broken", "unreachable"
        return "ok", classify_landing_page(result.text)


def classify_landing_page(text: str) -> str:
    signals = matched_signals(strip_tags(text))
    strong = {"start your free trial", "start a free trial", "free trial",
              "intro offer", "introductory offer", "intro pricing", "trial period"}
    if any(s in strong for s in signals):
        return "trial-page"
    if signals:
        return "promo-page"
    return "reachable-no-trial-signals"


# ---------------------------------------------------------------------------
# Candidate extraction
# ---------------------------------------------------------------------------
def extract_candidates(source: dict, text: str, *,
                       verifier: LinkVerifier | None = None,
                       now: str | None = None) -> list[TrialCandidate]:
    """Extract ranked candidates from a fetched source body.

    Kept backward compatible: extract_candidates(source, text) still works.
    Pass a LinkVerifier to enable landing-page verification.
    """
    discovered_at = now or datetime.now(UTC).isoformat()
    is_feed = source.get("type") in {"rss", "newsletter"} or looks_like_feed(text)
    if is_feed:
        snippet_groups = [feed_snippets(source["url"], text)]
        page_text = ""
    else:
        page_text = strip_boilerplate(text)
        link_snips = link_snippets(source["url"], text)
        # Page-level fallback only fires when no link carried a signal:
        # otherwise the source page would self-report as a candidate on
        # every run, duplicating the linked offer.
        snippet_groups = [link_snips, [(page_text, source["url"], "")]]

    page_structured = {
        "trial_days": extract_trial_days(page_text),
        "price_hint": extract_price_hint(page_text),
        "eligibility_hint": extract_eligibility_hint(page_text),
    }

    candidates: list[TrialCandidate] = []
    seen: set[str] = set()
    for snippets in snippet_groups:
        for snippet_text, candidate_url, snippet_title in snippets:
            signals = matched_signals(snippet_text)
            if not signals:
                continue
            negative = matched_negative_signals(snippet_text)
            url = canonical_url(candidate_url)
            try:
                validate_public_url(url)
            except URLError:
                continue
            title = (snippet_title or snippet_text[:140]).strip(" -:|")
            if len(title) < 12:
                continue
            key = f"{title}:{url}"
            if key in seen:
                continue
            seen.add(key)

            trial_days = extract_trial_days(snippet_text) or page_structured["trial_days"]
            price_hint = extract_price_hint(snippet_text) or page_structured["price_hint"]
            eligibility_hint = (extract_eligibility_hint(snippet_text)
                                or page_structured["eligibility_hint"])

            if verifier is not None and source.get("verify_links", False):
                link_status, landing_match = verifier.check(url)
            else:
                link_status, landing_match = "not_checked", "not_checked"

            candidates.append(TrialCandidate(
                source_id=source["id"],
                source_label=source["label"],
                source_type=source.get("type", "html"),
                title=title,
                url=url,
                source_url=source["url"],
                categories=list(source.get("categories", [])),
                confidence=source_confidence(source, url),
                score=score_candidate(source, url, signals, negative, landing_match),
                signals=signals,
                link_status=link_status,
                landing_match=landing_match,
                trial_days=trial_days,
                price_hint=price_hint,
                eligibility_hint=eligibility_hint,
                discovered_at=discovered_at,
            ))
            if len(candidates) >= int(source.get("max_candidates", 20)):
                break
        if candidates:
            break  # link-level hits make the page fallback redundant
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def link_snippets(base_url: str, html: str) -> list[tuple[str, str, str]]:
    """Return (label, url, title) for anchors whose label carries meaning."""
    snippets: list[tuple[str, str, str]] = []
    for label, href in extract_links(base_url, html):
        # Skip nav junk: single-word labels rarely carry offer details,
        # unless the label itself contains a trial signal.
        if len(label.split()) < 4 and not matched_signals(label):
            continue
        snippets.append((label, href, label[:140]))
    return snippets


def feed_snippets(source_url: str, text: str) -> list[tuple[str, str, str]]:
    """One snippet per feed item: title + summary linked at the item URL."""
    snippets: list[tuple[str, str, str]] = []
    for item in parse_feed_items(text):
        link = item["link"] or source_url
        combined = f"{item['title']}. {item['summary']}".strip(". ")
        snippets.append((combined, link, item["title"][:140]))
    return snippets


# ---------------------------------------------------------------------------
# User submissions
# ---------------------------------------------------------------------------
def load_user_submissions(verifier: LinkVerifier | None,
                          errors: list[str],
                          now: str) -> list[TrialCandidate]:
    if not SUBMISSION_FILE.exists():
        return []
    try:
        submitted_items = json.loads(SUBMISSION_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"user-submission: invalid JSON: {exc}")
        return []
    candidates: list[TrialCandidate] = []
    for item in submitted_items:
        try:
            submission = UserSubmission(
                title=item["title"],
                url=canonical_url(item["url"]),
                categories=list(item.get("categories", [])),
                submitted_by=item.get("submitted_by", "anonymous"),
                upvotes=int(item.get("upvotes", 0)),
                saves=int(item.get("saves", 0)),
                reports=int(item.get("reports", 0)),
                verified=parse_bool(item.get("verified", False)),
            )
            validate_public_url(submission.url)
        except (KeyError, TypeError, ValueError, URLError) as exc:
            errors.append(f"user-submission: {exc}")
            continue
        combined = f"{submission.title}"
        signals = ["user submitted"]
        negative = matched_negative_signals(combined)
        if verifier is not None and submission.verified:
            link_status, landing_match = verifier.check(submission.url)
        else:
            link_status, landing_match = "not_checked", "not_checked"
        score = 25 + score_signals(signals, negative)
        score += min(submission.upvotes, 10) * 3
        score += min(submission.saves, 10) * 4
        score -= submission.reports * 18
        if submission.verified:
            score += 25
        if link_status == "broken":
            score -= 30
        if landing_match == "trial-page":
            score += 15
        candidates.append(TrialCandidate(
            source_id="user-submissions",
            source_label="User submissions",
            source_type="submission",
            title=submission.title,
            url=submission.url,
            source_url=submission.url,
            categories=submission.categories,
            confidence="community-verified" if submission.verified else "candidate",
            score=cap_submission_score(max(0, min(100, score)), submission.verified),
            signals=signals,
            link_status=link_status,
            landing_match=landing_match,
            trial_days=extract_trial_days(combined),
            price_hint=extract_price_hint(combined),
            eligibility_hint=extract_eligibility_hint(combined),
            discovered_at=now,
        ))
    candidates.sort(key=lambda item: item.score, reverse=True)
    return candidates


def parse_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return False


def cap_submission_score(score: int, verified: bool) -> int:
    # Community content must earn rank: unverified submissions can never
    # outrank a decent official offer, no matter the votes.
    return min(score, 90 if verified else 55)


# ---------------------------------------------------------------------------
# State: diffing across runs
# ---------------------------------------------------------------------------
def load_state(data_dir: Path) -> dict:
    path = data_dir / "state.json"
    if not path.exists():
        return {"version": 1, "sources": {}, "candidates": {}}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": 1, "sources": {}, "candidates": {}}
    state.setdefault("sources", {})
    state.setdefault("candidates", {})
    return state


def save_state(data_dir: Path, state: dict) -> None:
    (data_dir / "state.json").write_text(
        json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def apply_state(candidates: list[TrialCandidate], state: dict,
                fetched_source_ids: set[str], now: str) -> list[TrialCandidate]:
    """Diff candidates against previous state; set status/first_seen/last_seen.

    Returns new candidate objects (dataclass is frozen) including 'gone'
    entries for previously seen URLs missing from a successfully fetched
    source.
    """
    stored: dict = state.get("candidates", {})
    seen_urls: set[str] = set()
    result: list[TrialCandidate] = []

    for cand in candidates:
        seen_urls.add(cand.url)
        entry = stored.get(cand.url)
        content_hash = candidate_content_hash(cand.title, cand.signals,
                                              cand.trial_days, cand.price_hint)
        if entry is None:
            status, first_seen = "new", now
        elif entry.get("content_hash") != content_hash:
            status, first_seen = "updated", entry.get("first_seen", now)
        else:
            status, first_seen = "unchanged", entry.get("first_seen", now)
        stored[cand.url] = {
            "title": cand.title,
            "source_id": cand.source_id,
            "source_label": cand.source_label,
            "source_type": cand.source_type,
            "source_url": cand.source_url,
            "categories": cand.categories,
            "confidence": cand.confidence,
            "signals": cand.signals,
            "trial_days": cand.trial_days,
            "price_hint": cand.price_hint,
            "eligibility_hint": cand.eligibility_hint,
            "first_seen": first_seen,
            "last_seen": now,
            "content_hash": content_hash,
            "score": cand.score,
        }
        result.append(TrialCandidate(
            **{**asdict(cand), "status": status,
               "first_seen": first_seen, "last_seen": now}))

    # Gone: previously seen from a source that fetched fine, now absent.
    for url, entry in stored.items():
        if url in seen_urls:
            continue
        if entry.get("source_id") in fetched_source_ids:
            entry["status"] = "gone"
            entry["last_seen"] = now
            result.append(TrialCandidate(
                source_id=entry.get("source_id", ""),
                source_label=entry.get("source_label", entry.get("source_id", "")),
                source_type=entry.get("source_type", ""),
                title=entry.get("title", url),
                url=url,
                source_url=entry.get("source_url", url),
                categories=entry.get("categories", []),
                confidence=entry.get("confidence", "candidate"),
                score=entry.get("score", 0),
                signals=entry.get("signals", []),
                link_status="not_checked",
                landing_match="not_checked",
                trial_days=entry.get("trial_days"),
                price_hint=entry.get("price_hint"),
                eligibility_hint=entry.get("eligibility_hint"),
                status="gone",
                first_seen=entry.get("first_seen", ""),
                last_seen=now,
                discovered_at=entry.get("first_seen", ""),
            ))
    state["candidates"] = stored
    result.sort(key=lambda item: item.score, reverse=True)
    return result


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_trials(path: Path, candidates: list[TrialCandidate], now: str) -> None:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now,
        "count": len(candidates),
        "counts_by_status": {
            status: sum(1 for c in candidates if c.status == status)
            for status in ("new", "updated", "unchanged", "gone")
        },
        "candidates": [asdict(c) for c in candidates],
    }
    write_json(path, payload)


def write_alerts(path: Path, candidates: list[TrialCandidate],
                 errors: list[str], now: str) -> None:
    lines = [f"# TryWise Alert Digest — {now}", ""]
    sections = (
        ("new", "## New candidates"),
        ("updated", "## Updated candidates"),
        ("gone", "## Gone candidates"),
    )
    any_news = False
    for status, heading in sections:
        group = [c for c in candidates if c.status == status]
        if not group:
            continue
        any_news = True
        lines.append(heading)
        lines.append("")
        for item in group:
            detail = item.title
            extras = []
            if item.trial_days:
                extras.append(f"{item.trial_days}-day trial")
            if item.price_hint:
                extras.append(item.price_hint)
            if item.eligibility_hint:
                extras.append(item.eligibility_hint)
            if extras:
                detail += f" ({'; '.join(extras)})"
            lines.append(f"- [{item.source_label}] {detail}")
            lines.append(f"  {item.url}  (score {item.score}, {item.confidence})")
        lines.append("")
    if not any_news:
        lines.append("No new, updated, or gone candidates since the last run.")
        lines.append("")
    unchanged = sum(1 for c in candidates if c.status == "unchanged")
    lines.append(f"{unchanged} unchanged candidate(s) carried over.")
    lines.append("")
    if errors:
        lines.extend(["## Source errors", "",
                      *[f"- {error}" for error in errors], ""])
    path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def log(message: str, quiet: bool) -> None:
    if not quiet:
        print(f"[{datetime.now(UTC).isoformat(timespec='seconds')}] {message}",
              file=sys.stderr)


def run_collection(source_file: Path, data_dir: Path,
                   quiet: bool = False) -> tuple[list[TrialCandidate], list[str]]:
    data_dir.mkdir(parents=True, exist_ok=True)
    sources = json.loads(source_file.read_text(encoding="utf-8"))
    if isinstance(sources, dict):  # tolerate {"sources": [...]} envelopes
        sources = sources.get("sources", [])
    now = datetime.now(UTC).isoformat()
    state = load_state(data_dir)
    fetcher = PoliteFetcher()
    verifier = LinkVerifier(fetcher)
    errors: list[str] = []
    candidates: list[TrialCandidate] = []
    fetched_ok: set[str] = set()

    for source in sources:
        if not source.get("enabled", False):
            continue
        log(f"fetching {source['id']} ({source['url']})", quiet)
        state_entry = state.get("sources", {}).get(source["id"])
        result = fetch_with_304(source["url"], fetcher, state_entry)
        state.setdefault("sources", {})[source["id"]] = {
            "last_run": now,
            "ok": result.ok,
            "status": result.status,
            "quality": result.quality,
            "robots": result.robots,
            "etag": result.etag or (state_entry or {}).get("etag", ""),
            "last_modified": result.last_modified or (state_entry or {}).get("last_modified", ""),
            "error": result.error,
        }
        if result.robots == "blocked":
            errors.append(f"{source['id']}: blocked by robots.txt ({result.error})")
            continue
        if not result.ok:
            errors.append(f"{source['id']}: {result.error or 'fetch failed'}")
            continue
        if result.not_modified:
            log(f"{source['id']}: not modified since last run", quiet)
            fetched_ok.add(source["id"])
            continue
        try:
            extracted = extract_candidates(source, result.text, verifier=verifier, now=now)
        except Exception as exc:  # never let one bad source kill the run
            errors.append(f"{source['id']}: extraction failed: {exc}")
            continue
        log(f"{source['id']}: {len(extracted)} candidate(s)", quiet)
        candidates.extend(extracted)
        fetched_ok.add(source["id"])

    candidates.extend(load_user_submissions(verifier, errors, now))
    candidates = apply_state(candidates, state, fetched_ok, now)
    save_state(data_dir, state)
    write_trials(data_dir / "trials.generated.json", candidates, now)
    write_alerts(data_dir / "alerts.generated.md", candidates, errors, now)
    return candidates, errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TryWise trial-candidate collector")
    parser.add_argument("--sources", default=str(DEFAULT_SOURCE_FILE))
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    candidates, errors = run_collection(Path(args.sources), Path(args.data_dir),
                                        quiet=args.quiet)
    new = sum(1 for c in candidates if c.status == "new")
    updated = sum(1 for c in candidates if c.status == "updated")
    gone = sum(1 for c in candidates if c.status == "gone")
    print(f"wrote {len(candidates)} candidates "
          f"({new} new, {updated} updated, {gone} gone)")
    if errors:
        print(f"{len(errors)} source errors", file=sys.stderr)
        if not args.quiet:
            for error in errors:
                print(f"  - {error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

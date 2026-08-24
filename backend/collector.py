from __future__ import annotations

import json
import re
import socket
import ssl
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from html import unescape
from html.parser import HTMLParser
from ipaddress import ip_address
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SOURCE_FILE = ROOT / "sources.json"
SUBMISSION_FILE = ROOT / "submissions.json"
TRIAL_KEYWORDS = (
    "free trial",
    "trial",
    "intro offer",
    "intro pricing",
    "free for",
    "promo",
    "promotion",
    "coupon",
    "limited time",
    "first month",
    "first year",
    "podcast",
)
MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 500_000


@dataclass(frozen=True)
class TrialCandidate:
    source_id: str
    source_label: str
    source_type: str
    title: str
    url: str
    source_url: str
    categories: list[str]
    confidence: str
    score: int
    signals: list[str]
    link_status: str
    landing_match: str
    discovered_at: str


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


def main() -> int:
    DATA_DIR.mkdir(exist_ok=True)
    sources = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    candidates: list[TrialCandidate] = []
    errors: list[str] = []

    for source in sources:
        if not source.get("enabled", False):
            continue
        try:
            text = fetch(source["url"])
        except URLError as exc:
            errors.append(f"{source['id']}: {exc}")
            continue
        candidates.extend(extract_candidates(source, text))

    candidates.extend(load_user_submissions(errors))
    candidates.sort(key=lambda item: item.score, reverse=True)
    write_json(DATA_DIR / "trials.generated.json", [asdict(item) for item in candidates])
    write_alerts(DATA_DIR / "alerts.generated.md", candidates, errors)
    print(f"wrote {len(candidates)} candidates")
    if errors:
        print(f"{len(errors)} source errors", file=sys.stderr)
    return 0


def fetch(url: str, *, redirects_remaining: int = MAX_REDIRECTS) -> str:
    parsed, resolved_ip = validate_public_url(url)
    status, headers, raw = fetch_once(parsed, resolved_ip)
    if status in {301, 302, 303, 307, 308}:
        if redirects_remaining < 1:
            raise URLError("too many redirects")
        location = headers.get("location")
        if not location:
            raise URLError("redirect response did not include Location")
        return fetch(urljoin(url, location), redirects_remaining=redirects_remaining - 1)
    if status < 200 or status >= 300:
        raise URLError(f"source returned HTTP {status}")
    return raw.decode("utf-8", errors="replace")


def fetch_once(parsed, resolved_ip) -> tuple[int, dict[str, str], bytes]:
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"

    with socket.create_connection((str(resolved_ip), port), timeout=12) as sock:
        connection = sock
        if parsed.scheme == "https":
            context = ssl.create_default_context()
            connection = context.wrap_socket(sock, server_hostname=parsed.hostname)

        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {parsed.hostname}\r\n"
            "User-Agent: TryWiseBot/0.1 (+mailto:sohan.botke@gmail.com)\r\n"
            "Accept: text/html, application/rss+xml, application/xml;q=0.9, */*;q=0.8\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        connection.sendall(request)
        with connection.makefile("rb") as response:
            status_line = response.readline(8192).decode("iso-8859-1").strip()
            status = parse_status(status_line)
            headers = read_headers(response)
            body = response.read(MAX_RESPONSE_BYTES + 1)
    return status, headers, body[:MAX_RESPONSE_BYTES]


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
            headers[name.strip().lower()] = value.strip()


def validate_public_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise URLError("only http and https sources are allowed")
    if not parsed.hostname:
        raise URLError("source URL must include a hostname")

    hostname = parsed.hostname.strip().lower()
    if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
        raise URLError("local hostnames are not allowed")

    resolved = resolve_public_ips(hostname, parsed.port)
    return parsed, resolved[0]


def resolve_public_ips(hostname: str, port: int | None):
    try:
        addresses = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
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


def is_public_ip(ip) -> bool:
    return ip.is_global


def extract_candidates(source: dict, text: str) -> list[TrialCandidate]:
    discovered_at = datetime.now(UTC).isoformat()
    candidates: list[TrialCandidate] = []
    seen: set[str] = set()
    snippets = [*extract_links(source["url"], text), (strip_tags(text), source["url"])]

    for text_block, candidate_url in snippets:
        for sentence in split_sentences(text_block):
            signals = matched_signals(sentence)
            if not signals:
                continue
            title = sentence[:140].strip(" -:|")
            key = f"{title}:{candidate_url}"
            if len(title) < 12 or key in seen:
                continue
            try:
                validate_public_url(candidate_url)
            except URLError:
                continue
            seen.add(key)
            link_status, landing_match = link_status_for_candidate(
                candidate_url,
                source.get("verify_links", False),
            )
            candidates.append(
                TrialCandidate(
                    source_id=source["id"],
                    source_label=source["label"],
                    source_type=source.get("type", "html"),
                    title=title,
                    url=candidate_url,
                    source_url=source["url"],
                    categories=list(source.get("categories", [])),
                    confidence=source_confidence(source, candidate_url),
                    score=score_candidate(source, candidate_url, signals),
                    signals=signals,
                    link_status=link_status,
                    landing_match=landing_match,
                    discovered_at=discovered_at,
                )
            )
            if len(candidates) >= int(source.get("max_candidates", 20)):
                return sorted(candidates, key=lambda item: item.score, reverse=True)
    return sorted(candidates, key=lambda item: item.score, reverse=True)


class LinkExtractor(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__()
        self.base_url = base_url
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self._href = urljoin(self.base_url, href)
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or not self._href:
            return
        label = re.sub(r"\s+", " ", " ".join(self._text)).strip()
        if label:
            self.links.append((label, self._href))
        self._href = None
        self._text = []


def extract_links(base_url: str, text: str) -> list[tuple[str, str]]:
    parser = LinkExtractor(base_url)
    parser.feed(text)
    return parser.links


def matched_signals(text: str) -> list[str]:
    lowered = text.lower()
    return [keyword for keyword in TRIAL_KEYWORDS if keyword in lowered]


def source_confidence(source: dict, url: str) -> str:
    parsed_source = urlparse(source["url"])
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


def score_candidate(source: dict, url: str, signals: list[str]) -> int:
    score = 20 + len(signals) * 8
    if source.get("type") == "official":
        score += 30
    elif source.get("type") in {"rss", "newsletter", "deal-site"}:
        score += 18
    elif source.get("type") in {"forum", "podcast"}:
        score += 10
    if urlparse(source["url"]).netloc == urlparse(url).netloc:
        score += 12
    if any(signal in {"free trial", "intro offer", "first month"} for signal in signals):
        score += 12
    return score


def link_status_for_candidate(url: str, should_verify: bool) -> tuple[str, str]:
    try:
        validate_public_url(url)
    except URLError:
        return "blocked", "unsafe-url"
    if not should_verify:
        return "not_checked", "not_checked"
    try:
        text = fetch(url)
    except URLError:
        return "broken", "unreachable"
    return "ok", classify_landing_page(text)


def classify_landing_page(text: str) -> str:
    signals = matched_signals(strip_tags(text))
    if any(signal in {"free trial", "trial", "intro offer", "intro pricing"} for signal in signals):
        return "trial-page"
    if signals:
        return "promo-page"
    return "reachable-no-trial-signals"


def load_user_submissions(errors: list[str]) -> list[TrialCandidate]:
    if not SUBMISSION_FILE.exists():
        return []
    try:
        submitted_items = json.loads(SUBMISSION_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"user-submission: invalid JSON: {exc}")
        return []
    discovered_at = datetime.now(UTC).isoformat()
    candidates: list[TrialCandidate] = []
    for item in submitted_items:
        try:
            submission = UserSubmission(
                title=item["title"],
                url=item["url"],
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
        score = 25 + min(submission.upvotes, 10) * 3 + min(submission.saves, 10) * 4 - submission.reports * 18
        if submission.verified:
            score += 25
        link_status, landing_match = link_status_for_candidate(submission.url, submission.verified)
        if link_status == "broken":
            score -= 30
        if landing_match == "trial-page":
            score += 15
        candidates.append(
            TrialCandidate(
                source_id="user-submissions",
                source_label="User submissions",
                source_type="submission",
                title=submission.title,
                url=submission.url,
                source_url=submission.url,
                categories=submission.categories,
                confidence="community-verified" if submission.verified else "candidate",
                score=cap_submission_score(max(0, score), submission.verified),
                signals=["user submitted"],
                link_status=link_status,
                landing_match=landing_match,
                discovered_at=discovered_at,
            )
        )
    return sorted(candidates, key=lambda item: item.score, reverse=True)


def parse_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    return False


def cap_submission_score(score: int, verified: bool) -> int:
    return min(score, 90 if verified else 55)


def strip_tags(text: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def split_sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\s+[|•]\s+", text) if part.strip()]


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_alerts(path: Path, candidates: list[TrialCandidate], errors: list[str]) -> None:
    lines = ["# TryWise Alert Digest", ""]
    if not candidates:
        lines.append("No trial candidates found.")
    for item in candidates:
        lines.append(f"- [{item.source_label}] {item.title}")
        lines.append(f"  - {item.url}")
    if errors:
        lines.extend(["", "## Source Errors", *[f"- {error}" for error in errors]])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import json
import re
import socket
import ssl
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from html import unescape
from ipaddress import ip_address
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
SOURCE_FILE = ROOT / "sources.json"
TRIAL_KEYWORDS = ("free trial", "trial", "free for", "promo", "limited time")
MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 500_000


@dataclass(frozen=True)
class TrialCandidate:
    source_id: str
    source_label: str
    title: str
    url: str
    categories: list[str]
    confidence: str
    discovered_at: str


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
            "User-Agent: TrialForgeBot/0.1 (+https://github.com/sohanbotke/trialforge)\r\n"
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
    stripped = strip_tags(text)
    discovered_at = datetime.now(UTC).isoformat()
    candidates: list[TrialCandidate] = []
    seen: set[str] = set()

    for sentence in split_sentences(stripped):
        lowered = sentence.lower()
        if not any(keyword in lowered for keyword in TRIAL_KEYWORDS):
            continue
        title = sentence[:120].strip(" -:|")
        if len(title) < 16 or title in seen:
            continue
        seen.add(title)
        candidates.append(
            TrialCandidate(
                source_id=source["id"],
                source_label=source["label"],
                title=title,
                url=source["url"],
                categories=list(source.get("categories", [])),
                confidence="candidate",
                discovered_at=discovered_at,
            )
        )
        if len(candidates) >= 10:
            break
    return candidates


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
    lines = ["# TrialForge Alert Digest", ""]
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

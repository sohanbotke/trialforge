"""Bounded, policy-gated collection. Nothing here publishes the app catalog."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import http.client
from html import escape
import json
import os
from pathlib import Path
import re
import socket
import signal
import ssl
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from urllib.error import URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
from zoneinfo import ZoneInfo

from collector import validate_public_url, strip_tags

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data' / 'nightly'
AGENT = 'TryWiseBot/0.2 (+https://trywise-9f8e1.web.app)'
MAX_BYTES = 2_000_000
SIGNALS = re.compile(r'\b(?:free trial|free tier|free plan|free account|trial|intro offer|promotion|coupon|discount|free)\b', re.I)


class BatchTimeout(RuntimeError):
    pass


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.pending-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_json(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def checked_url(url, hosts):
    parts = urlsplit(url)
    if (parts.scheme != 'https' or parts.hostname not in hosts or parts.username
            or parts.password or parts.port not in (None, 443) or len(url) > 2000
            or re.search(r'[\x00-\x20\x7f]', url)):
        raise ValueError('URL outside approved HTTPS hosts')
    validate_public_url(url)  # Reject *all* private/reserved DNS answers.
    return parts


class Fetcher:
    def __init__(self):
        self.robots = {}
        self.last_request = {}
        self.requests = 0

    def request(self, url, hosts, delay=2):
        parts = checked_url(url, hosts)
        # Resolve again and pin the validated public address; DNS cannot redirect
        # the actual socket to localhost between validation and connection.
        _, address = validate_public_url(url)
        self.requests += 1
        if self.requests > 30:
            raise ValueError('Per-run request limit reached')
        wait = delay - (time.monotonic() - self.last_request.get(parts.hostname, 0))
        if wait > 0:
            time.sleep(wait)
        self.last_request[parts.hostname] = time.monotonic()
        target = urlunsplit(('', '', parts.path or '/', parts.query, ''))
        with socket.create_connection((str(address), 443), timeout=15) as sock:
            with ssl.create_default_context().wrap_socket(sock, server_hostname=parts.hostname) as conn:
                conn.sendall((f'GET {target} HTTP/1.1\r\nHost: {parts.hostname}\r\n'
                              f'User-Agent: {AGENT}\r\nAccept: text/plain, text/markdown, text/html\r\n'
                              'Accept-Encoding: identity\r\nConnection: close\r\n\r\n').encode('ascii'))
                response = http.client.HTTPResponse(conn)
                response.begin()
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError('Source response too large')
                if response.getheader('Content-Encoding', 'identity') != 'identity':
                    raise ValueError('Unexpected compressed response')
                return response.status, dict((k.lower(), v) for k, v in response.getheaders()), raw.decode('utf-8', errors='replace')

    def policy(self, url, hosts):
        parts = checked_url(url, hosts)
        origin = f'https://{parts.hostname}'
        if origin not in self.robots:
            status, _, body = self.request(origin + '/robots.txt', hosts)
            # Redirects, authorization failures, and server failures fail closed.
            if status not in (200, 404):
                raise ValueError(f'Robots policy unavailable: HTTP {status}')
            if status == 404:
                body = 'User-agent: *\nAllow: /'
            if len(body) > 100_000 or '<html' in body.lower():
                raise ValueError('Invalid robots response')
            parser = RobotFileParser()
            parser.parse(body.splitlines())
            self.robots[origin] = (parser, body)
        parser, body = self.robots[origin]
        if not parser.can_fetch(AGENT, url):
            raise ValueError('Disallowed by robots.txt')
        # stdlib does not implement wildcard rules; conservatively honor them
        # across groups rather than accidentally treating them as literal '*'.
        for line in body.splitlines():
            key, _, rule = line.partition(':')
            rule = rule.split('#')[0].strip()
            if key.strip().lower() == 'disallow' and ('*' in rule or '$' in rule):
                pattern = re.escape(rule).replace(r'\*', '.*').replace(r'\$', '$')
                if re.match(pattern, parts.path + ('?' + parts.query if parts.query else '')):
                    raise ValueError('Disallowed by wildcard robots rule')
        delay = max(2, parser.crawl_delay(AGENT) or parser.crawl_delay('*') or 0)
        rate = parser.request_rate(AGENT) or parser.request_rate('*')
        if rate:
            delay = max(delay, rate.seconds / rate.requests)
        if delay > 60:
            raise ValueError('Robots crawl delay exceeds batch limit')
        return delay

    def fetch(self, url, hosts):
        for _ in range(6):
            delay = self.policy(url, hosts)
            status, headers, body = self.request(url, hosts, delay)
            if status in (301, 302, 303, 307, 308):
                if not headers.get('location'):
                    raise ValueError('Redirect without location')
                url = urljoin(url, headers['location'])
                continue  # Recheck host, public DNS, and robots on every hop.
            if status != 200:
                raise ValueError(f'HTTP {status}; needs review, not proof of expiration')
            if not any(kind in headers.get('content-type', '') for kind in ('text/', 'application/json', 'application/xml')):
                raise ValueError('Unexpected content type')
            if re.search(r'captcha|verify you are human|just a moment\.\.\.', body[:4000], re.I):
                raise ValueError('Bot challenge; no bypass attempted')
            return body, url
        raise ValueError('Too many redirects')


def candidate(source, body, fetched_url, now):
    text = strip_tags(body) if source['format'] == 'html' else body
    snippets = []
    excerpt_end = -1
    for match in SIGNALS.finditer(text):
        if match.start() < excerpt_end:
            continue
        snippet = re.sub(r'\s+', ' ', text[max(0, match.start() - 80):match.end() + 180]).strip()
        excerpt_end = match.end() + 180
        if snippet not in snippets:
            snippets.append(snippet)
        if len(snippets) == 6:
            break
    if not snippets:
        return None
    payload = {
        'sourceId': source['id'], 'title': source['label'],
        'url': source['offer_url'], 'sourceUrl': source['url'],
        'evidenceUrl': fetched_url, 'evidence': snippets,
        'categories': source['categories'], 'license': source['license'],
        'attribution': source['attribution'], 'policyUrl': source['policy_url'],
        'policyReviewedAt': source['policy_reviewed'],
        'status': 'pending_review', 'verificationStatus': 'unverified',
        'schemaVersion': 1,
        'pageHash': hashlib.sha256(re.sub(r'\s+', ' ', text).strip().encode()).hexdigest(),
        'reviewRequired': ['offer type', 'duration', 'renewal price and billing period',
                           'country and eligibility', 'expiry', 'cancellation terms'],
    }
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    payload.update({'id': digest, 'observedAt': now, 'contentHash': digest})
    return payload


def collect(sources, fetcher, now, drafter=None):
    candidates, results = [], []
    for source in sources:
        if not source.get('enabled'):
            continue
        try:
            reviewed = datetime.fromisoformat(source['policy_reviewed']).date()
            today = datetime.fromisoformat(now).date()
            if not 0 <= (today - reviewed).days <= 90:
                raise ValueError('Source policy review is missing, future-dated, or over 90 days old')
            if not source.get('policy_url') or not source.get('license'):
                raise ValueError('Source needs a documented policy review')
            body, url = fetcher.fetch(source['url'], source['allowed_hosts'])
            item = candidate(source, body, url, now)
            if item:
                if drafter:
                    item = drafter.enrich(item, body)
                candidates.append(item)
            results.append({'sourceId': source['id'], 'status': 'fetched' if item else 'no_signals',
                            'candidateId': item['id'] if item else None,
                            'draftStatus': item.get('draftStatus', 'disabled') if item else 'not_applicable'})
        except (ValueError, KeyError, OSError, URLError, http.client.HTTPException) as error:
            results.append({'sourceId': source.get('id', 'invalid'), 'status': 'needs_review', 'error': str(error)[:300]})
    return candidates, results


def is_due(state, now):
    local = now.astimezone(ZoneInfo('America/Chicago'))
    return local.hour >= 3 and state.get('scheduledCollectionDate') != local.date().isoformat()


def review_report(candidates, run):
    cards = []
    for item in candidates:
        cards.append(f'<article><h2>{escape(item["title"])}</h2><p>Unverified · pending review</p>'
                     f'<p><a href="{escape(item["url"], quote=True)}" rel="noreferrer">Official source</a></p>'
                     '<ul>' + ''.join(f'<li>{escape(v)}</li>' for v in item['evidence']) + '</ul>'
                     f'<p>{escape(item["attribution"])} · {escape(item["license"])}</p>'
                     f'<small>Observed: {escape(item["observedAt"])}</small></article>')
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>TryWise collector review</title><style>body{font:17px system-ui;max-width:900px;margin:32px auto;padding:16px;line-height:1.6}'
            'article{border:1px solid #bbb;padding:20px;margin:20px 0;border-radius:12px}li{overflow-wrap:anywhere}</style>'
            '<h1>TryWise: latest collection</h1><p>These are discovery signals, not verified offers. Nothing has been published.</p>'
            f'<p>Run: {escape(run["id"])} · {escape(run["status"])}</p>'
            + ''.join(cards) + '<h2>Source checks</h2><pre>' + escape(json.dumps(run['sourceResults'], indent=2)) + '</pre></html>')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scheduled', action='store_true')
    parser.add_argument('--local-only', action='store_true', help='Collect without uploading; retain outbox')
    parser.add_argument('--upload-only', action='store_true')
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--node', default='node')
    parser.add_argument('--no-drafts', action='store_true', help='Skip local Ollama extraction')
    args = parser.parse_args()
    if args.status:
        latest = read_json(DATA / 'latest.json', {})
        pending = read_json(DATA / 'outbox.json', {})
        print(json.dumps({'latestRun': latest.get('run'), 'pendingUploads': len(pending)}, indent=2))
        return 0
    def timed_out(*_):
        raise BatchTimeout('Collector exceeded its 5-minute run limit; saved outbox remains recoverable')
    signal.signal(signal.SIGALRM, timed_out)
    signal.alarm(300)
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (DATA / 'collector.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        state = read_json(DATA / 'state.json', {'seen': {}})
        now = datetime.now(timezone.utc)
        pending = read_json(DATA / 'outbox.json', {})
        due = not args.upload_only and (not args.scheduled or is_due(state, now))
        if due:
            stamp = now.isoformat()
            sources = read_json(ROOT / 'nightly-sources.json', [])
            from draft_fields import Drafter
            drafter = None if args.no_drafts else Drafter(DATA / 'draft-cache', atomic_json)
            candidates, results = collect(sources, Fetcher(), stamp, drafter)
            new_count = 0
            for item in candidates:
                if 'candidates/' + item['id'] in pending:
                    # Refresh only our not-yet-acknowledged local payload. Remote
                    # candidates remain immutable and uploads are create-only.
                    pending['candidates/' + item['id']] = item
                    atomic_json(DATA / 'reviews' / (item['id'] + '.json'), item)
                if item['id'] not in state['seen']:
                    atomic_json(DATA / 'reviews' / (item['id'] + '.json'), item)
                    pending['candidates/' + item['id']] = item
                    state['seen'][item['id']] = stamp
                    new_count += 1
            run_id = now.strftime('%Y%m%dT%H%M%S') + '-' + os.urandom(4).hex()
            run = {'id': run_id, 'observedAt': stamp, 'schemaVersion': 1,
                   'status': 'partial_failure' if any(r['status'] == 'needs_review' for r in results) else 'collected',
                   'candidatesFound': len(candidates), 'newVersions': new_count,
                   'sourceResults': results, 'candidateIds': [item['id'] for item in candidates]}
            pending['crawlRuns/' + run_id] = run
            # Persist outbox BEFORE marking candidates as seen (crash-safe retry).
            atomic_json(DATA / 'outbox.json', pending)
            if args.scheduled:
                state['scheduledCollectionDate'] = now.astimezone(ZoneInfo('America/Chicago')).date().isoformat()
            atomic_json(DATA / 'state.json', state)
            atomic_json(DATA / 'latest.json', {'run': run, 'candidates': candidates})
            (DATA / 'review.html').write_text(review_report(candidates, run))
            print(json.dumps(run), flush=True)
        if pending and not args.local_only:
            retry_at = datetime.fromisoformat(state.get('uploadRetryAt', '2000-01-01T00:00:00+00:00'))
            if args.scheduled and now < retry_at:
                return 0
            try:
                result = subprocess.run([args.node, str(ROOT / 'upload-nightly.mjs'), str(DATA / 'outbox.json')], timeout=180)
                code = result.returncode
            except (OSError, subprocess.TimeoutExpired):
                code = 1
            state['uploadRetryAt'] = (now + timedelta(hours=1)).isoformat()
            atomic_json(DATA / 'state.json', state)
            if code:
                print('Upload incomplete; private outbox retained for retry.', file=sys.stderr)
                return 1
        return 0


if __name__ == '__main__':
    raise SystemExit(main())

# TryWise Backend — Trial Candidate Collector

`collector.py` is a batch collector that turns allowlisted public sources into
ranked trial candidates. Standard library only — `python3 collector.py` is the
whole install.

## What it does

- Fetches allowlisted sources from `sources.json` (official offer pages,
  RSS/Atom feeds, deal sites, forums, podcast pages).
- **Honors robots.txt** per host (Disallow for `TryWiseBot`/`*`, plus
  Crawl-delay), with a per-host minimum interval between requests.
- Uses **conditional requests** (ETag / If-Modified-Since) so scheduled runs
  skip unchanged sources instead of re-downloading them.
- Parses RSS/Atom feeds item-by-item (not as blob text) and strips
  nav/header/footer boilerplate from HTML before extraction.
- Scores candidates with a **weighted signal engine**: positive phrases
  ("start your free trial", "intro offer") add weight, negative phrases
  ("offer expired", "trial has ended") subtract it. Scores are deterministic,
  0–100, and documented in `score_candidate`.
- Extracts structured offer data when present: **trial length in days**,
  **post-trial price hint** (`$9.99/mo`), and **eligibility hint**
  ("new customers").
- Verifies candidate landing pages within a per-run budget
  (`verify_links: true` on the source), and classifies them as
  `trial-page` / `promo-page` / `reachable-no-trial-signals`.
- Detects **JS-only pages** and non-HTML responses and records them on the
  source result (`fetch quality: js_required`) instead of silently yielding
  nothing.
- Merges optional user submissions from `submissions.json`, with score caps
  so unverified community content can never outrank a solid official offer.
- **Diffs across runs** via `data/state.json`: every candidate is reported as
  `new`, `updated`, `unchanged`, or `gone`. The alert digest only lists what
  changed.

## Safety

Every fetched URL (sources, redirects, candidate links, submission links) is
validated before use:

- Only `http`/`https`; no `file:`, no localhost, no `.local`.
- Hostnames are resolved and connections go only to **global (public) IPs** —
  private, reserved, and link-local ranges (including cloud metadata
  `169.254.169.254`) are rejected. Redirect targets are re-validated hop by hop.
- Responses are capped at 500 KB; chunked and gzip/deflate bodies are decoded.

## Run

```bash
python3 collector.py
python3 collector.py --sources /path/to/sources.json --data-dir /path/to/data --quiet
```

Contact email for the `User-Agent` header comes from `TRYWISE_CONTACT`
(defaults to the address in the module).

Tests:

```bash
python3 -m unittest test_collector
```

## Scheduling

The collector is designed for cron or GitHub Actions. Example weekly cron:

```cron
0 6 * * 1 cd /srv/trywise/backend && python3 collector.py --quiet >> collector.log 2>&1
```

Example GitHub Actions workflow (weekly, commits updated data) — a working
version lives at `.github/workflows/collect.yml`:

```yaml
on:
  schedule: [{ cron: "0 6 * * 1" }]
  workflow_dispatch:
jobs:
  collect:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: python3 -m unittest test_collector
        working-directory: backend
      - run: python3 backend/collector.py --quiet
        env:
          TRYWISE_CONTACT: ${{ secrets.TRYWISE_CONTACT }}
      - run: |
          git config user.name "trywise-collector"
          git config user.email "trywise-collector@users.noreply.github.com"
          git add backend/data
          git diff --cached --quiet || \
            git commit -m "chore: weekly trial candidate refresh" && git push
```

Keep `backend/data/state.json` committed — without it, every run reports
everything as `new`. Only enable the workflow (or set the schedule) once
you've done one real run locally and reviewed the first digest.

## Outputs (`backend/data/`)

- `trials.generated.json` — `{schema_version: 2, generated_at, counts_by_status,
  candidates: [...]}`. Each candidate carries `url`, `source_url`,
  `source_type`, `confidence` (`high`/`medium`/`candidate`/`community-verified`),
  `score`, `signals`, `link_status`, `landing_match`, `trial_days`,
  `price_hint`, `eligibility_hint`, `status` (`new`/`updated`/`unchanged`/`gone`),
  `first_seen`, `last_seen`.
- `alerts.generated.md` — digest with **New / Updated / Gone** sections plus
  source errors. Unchanged candidates are counted, not repeated.
- `state.json` — run state: per-source validators (ETag/last-modified) and
  per-candidate content hashes for diffing.

## Source policy

Only add sources that are:

- Publicly accessible.
- Allowed by the site's terms and robots policy (the collector enforces
  robots.txt, but the *decision* to list a source is still human).
- Useful without logging into a private account.
- Low volume enough for scheduled batch checks.

Per-source options in `sources.json`:

| Field | Meaning |
|---|---|
| `enabled` | Include in runs. |
| `type` | `official`, `rss`, `newsletter`, `deal-site`, `forum`, `podcast`. |
| `verify_links` | Verify candidate landing pages (budgeted, default off). |
| `max_candidates` | Cap candidates per source (default 20). |
| `allowed_domains` | Extra domains treated as same-source for confidence. |
| `categories` | TryWise categories the source feeds. |

Forums are pointers to possible deals, not authoritative sources. Official
product pages win when details conflict.

Generated candidates stay separate from the curated catalog until a user or
moderator confirms the link, eligibility, cancellation burden, and current
pricing. This prevents stale promotions from polluting the ranked product feed.

## Candidate ranking

Scores are deterministic and explainable:

- Base by source type: official +30, rss/newsletter/deal-site +18,
  forum/podcast +10.
- Positive signal phrases add their weight (capped at +60 total so repeated
  nav copy can't dominate); negative phrases subtract.
- Same-domain links +12; verified trial landing page +15.
- User submissions start at 25, earn points from upvotes/saves, lose heavily
  on reports, and are hard-capped (55 unverified, 90 verified) so they must
  earn rank over time.

Link verification is budgeted (40 landing pages per run by default, highest
scores first). Enable `verify_links: true` first for official pages and
verified user submissions; leave broad forums and search pages unchecked until
they prove valuable.

## Next steps

- Notification delivery for the alert digest (email, Telegram, web push).
- Feed `trials.generated.json` into the frontend catalog (static JSON import
  or API endpoint) with the `status` field driving "new/updated/gone" badges.
- Moderation queue UI for user-submitted links and podcast promo codes.
- Per-source parsers for the highest-value sources (replacing generic
  extraction where the HTML is too idiosyncratic).
- Playwright fallback for high-value JS-only sources that pass a
  robots/terms review (the collector already flags these as `js_required`).

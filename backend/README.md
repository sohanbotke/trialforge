# TryWise Backend Scaffold

This backend is intentionally small. It gives TryWise a path from curated static
data to scheduled public-source discovery for trials, promos, intro offers,
bundles, and cheaper ways to try a user requirement without requiring email,
bank, password, or browser-cookie access.

## Capabilities

- Read allowlisted public source definitions from `sources.json`.
- Fetch public pages or RSS endpoints.
- Extract simple trial-like candidates with conservative keyword matching.
- Preserve candidate URLs when a source page links directly to an offer page.
- Optionally check whether candidate links are reachable and whether the landing
  page still contains trial or promo signals.
- Score candidates by source quality, keyword signals, source/candidate domain
  match, and community feedback.
- Merge optional user submissions from `submissions.json`.
- Write generated candidates to `data/trials.generated.json`.
- Write an alert digest to `data/alerts.generated.md`.

## Run

```bash
python3 collector.py
```

No third-party packages are required for this scaffold.

To test the user-submission path locally:

```bash
cp submissions.example.json submissions.json
python3 collector.py
```

## Source Policy

Only add sources that are:

- Publicly accessible.
- Allowed by the site's terms and robots policy.
- Useful without logging into a private account.
- Low volume enough for scheduled batch checks.

Forums should be treated as pointers to possible deals, not as authoritative
sources. Official product pages should win when details conflict.

## Cheapest Scouting Architecture

Start with a batch collector, not a full crawler:

1. Official offer pages: pricing, trial, promo, and student/family pages.
2. Structured public feeds: RSS/newsletters/deal pages with stable URLs.
3. Community pointers: forums, podcast show notes, promo-code landing pages, and
   user submissions.
4. Browser automation fallback: Playwright only for high-value sources that
   require JavaScript and pass a robots/terms review.

Generated candidates should stay separate from the curated catalog until a user
or moderator confirms the link, eligibility, cancellation burden, and current
pricing. This prevents stale promotions from polluting the ranked product feed.

## Candidate Ranking

Each generated candidate includes:

- `url`: best known direct offer URL.
- `source_url`: page or feed where it was discovered.
- `source_type`: official, rss, deal-site, forum, podcast, or submission.
- `confidence`: high, medium, candidate, or community-verified.
- `score`: deterministic quality score for ordering.
- `signals`: keywords or user-signal reasons that caused discovery.
- `link_status`: ok, broken, or not_checked.
- `landing_match`: trial-page, promo-page, reachable-no-trial-signals, or
  not_checked.

User submissions are useful, but they should earn rank over time through saves,
upvotes, reports, and verification. A reported or unverified deal should never
outrank a current official offer page.

Link verification should be selective. Enable `verify_links: true` first for
official pages and verified user submissions. Leave broad forums, search result
pages, and podcast promo discovery sources unchecked until they prove valuable,
then add a purpose-built parser for that source.

## Next Steps

- Replace keyword extraction with per-source parsers.
- Add robots.txt checks before fetch.
- Add a scheduled runner such as GitHub Actions, Firebase Functions, or cron.
- Add notification delivery through email, Telegram, or web push.
- Feed generated candidates into the frontend catalog through a static JSON file
  or API endpoint.
- Add a moderation queue for user-submitted links and podcast promo codes.

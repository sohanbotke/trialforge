# TrialForge Backend Scaffold

This backend is intentionally small. It gives TrialForge a path from curated static
data to scheduled public-source discovery without requiring email, bank, password,
or browser-cookie access.

## Capabilities

- Read allowlisted public source definitions from `sources.json`.
- Fetch public pages or RSS endpoints.
- Extract simple trial-like candidates with conservative keyword matching.
- Write generated candidates to `data/trials.generated.json`.
- Write an alert digest to `data/alerts.generated.md`.

## Run

```bash
python3 collector.py
```

No third-party packages are required for this scaffold.

## Source Policy

Only add sources that are:

- Publicly accessible.
- Allowed by the site's terms and robots policy.
- Useful without logging into a private account.
- Low volume enough for scheduled batch checks.

Forums should be treated as pointers to possible deals, not as authoritative
sources. Official product pages should win when details conflict.

## Next Steps

- Replace keyword extraction with per-source parsers.
- Add robots.txt checks before fetch.
- Add a scheduled runner such as GitHub Actions, Firebase Functions, or cron.
- Add notification delivery through email, Telegram, or web push.
- Feed generated candidates into the frontend catalog through a static JSON file
  or API endpoint.

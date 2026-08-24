# TryWise

TryWise helps people find the cheapest, lowest-risk way to try what they need:
software, streaming, meals, delivery, local services, activities, subscriptions,
and other trial-friendly options.

The product is deliberately manual-first. It does not need email, bank, password,
or browser-extension access to be useful.

## What It Does

- Select interest areas such as family life, meals, shows, design, productivity, dev tools, learning, health, finance, and home projects.
- Complete first-run onboarding for interests, keywords, source comfort, alert cadence, and minimum trial value.
- Browse a curated local offer catalog with source, eligibility, trial length, value, and verification date.
- Build a requirement-first try plan, such as "cheapest way to watch live sports" or "meal kits for busy weekdays."
- Add a trial as an experiment with a goal, decision date, monthly value, and keep criteria.
- Review active trials before they convert using a practical checklist.
- Inspect the source radar and alert plan that a backend collector can use later.
- Generate a local optimization plan based on active trials and decisions.
- Export or copy your try plan without creating an account.

## Privacy Model

TryWise currently stores data in browser `localStorage`.

```text
Manual only       On by default
Email forwarding  Future optional import path
Bank scan         Not part of the MVP
```

Firebase config is included only as a future sync option. If `firebase-config.js`
still contains placeholder values, the app stays local-only.

## Backend And Extension Path

The repo includes scaffolds for the next product layer:

```text
backend/
  collector.py        Public-source trial candidate collector
  sources.json        Allowlisted source definitions
  README.md           Backend policy and run notes

extension/
  manifest.json       Chrome extension manifest
  popup.html          Trial candidate clipper UI
  popup.js            Saves current page candidates to Chrome local storage
```

The backend is not a private-data scraper. It is designed for public pages, RSS,
forums, newsletters, and deal sources that can be checked in batch with source
allowlists and rate limits. It also supports user-submitted findings, podcast
promo-code links, and community ranking signals through a submission file shape.
The Chrome extension is a future capture surface for saving a trial page while
browsing.

The intended catalog pipeline is:

```text
Seed catalog
Scheduled public-source collector
Generated candidate queue
User submissions and podcast promo links
Score by source quality, price exposure, usefulness, saves, and reports
Promote verified offers into the ranked catalog
```

## Run Locally

No build step is required.

```bash
python3 -m http.server 4177
```

Then open:

```text
http://127.0.0.1:4177
```

Opening `index.html` directly may not work in every browser because the app uses
JavaScript modules.

## Files

```text
index.html                  App UI, styles, and behavior
firebase-config.js          Optional Firebase placeholder config
assets/trywise-mark.svg  Local visual asset
backend/                    Public-source collector scaffold
extension/                  Chrome extension clipper scaffold
```

## Product Direction

The strongest version of TryWise is not just a subscription scanner. It is an
intent-to-option system:

```text
User states a requirement
Find trials, promos, intro offers, bundles, free tiers, and cheaper alternatives
Rank by total cost, risk, value, and cancellation burden
Track decision dates and reminders
Help the user keep only what creates repeated value
```

Future work should improve requirement capture, source coverage, ranking, and
alerts before adding high-trust integrations like email forwarding or financial
account scanning.

## Backend Run

```bash
cd backend
python3 collector.py
```

Generated files are written under `backend/data/` and are intentionally ignored by
Git.

## Test

Backend safety tests:

```bash
cd backend
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_collector.py
```

Optional browser journeys require Playwright and a local server:

```bash
npm install
python3 -m http.server 4177
npm run test:smoke
npm run test:journeys
```

The current catalog links were checked for reachability and trial/pricing/offer
signals. MasterClass blocks scripted checks, so the app marks that link as
browser-check-required instead of fully verified.

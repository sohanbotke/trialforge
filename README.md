# TrialForge

TrialForge is a private trial planner for discovering useful premium trials, testing
them intentionally, and making a keep/cancel decision before they convert.

The product is deliberately manual-first. It does not need email, bank, password,
or browser-extension access to be useful.

## What It Does

- Select interest areas such as family life, design, productivity, dev tools, learning, health, finance, and home projects.
- Complete first-run onboarding for interests, keywords, source comfort, alert cadence, and minimum trial value.
- Browse a curated local trial catalog with source, eligibility, trial length, value, and verification date.
- Add a trial as an experiment with a goal, decision date, monthly value, and keep criteria.
- Review active trials before they convert using a practical checklist.
- Inspect the source radar and alert plan that a backend collector can use later.
- Generate a local optimization plan based on active trials and decisions.
- Export or copy your trial plan without creating an account.

## Privacy Model

TrialForge currently stores data in browser `localStorage`.

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
allowlists and rate limits. The Chrome extension is a future capture surface for
saving a trial page while browsing.

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
assets/trialforge-mark.svg  Local visual asset
backend/                    Public-source collector scaffold
extension/                  Chrome extension clipper scaffold
```

## Product Direction

The strongest version of TrialForge is not a broad subscription scanner. It is a
trial experiment system:

```text
Discover relevant trials
Track decision dates
Define why each trial is being tested
Review evidence before conversion
Keep only what creates repeated value
```

Future work should improve the curated catalog and review workflow before adding
high-trust integrations like email forwarding or financial account scanning.

## Backend Run

```bash
cd backend
python3 collector.py
```

Generated files are written under `backend/data/` and are intentionally ignored by
Git.

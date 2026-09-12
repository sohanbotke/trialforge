# TryWise

TryWise helps people find the cheapest, lowest-risk way to try what they need:
software, streaming, meals, delivery, local services, activities, subscriptions,
and other trial-friendly options.

The product is deliberately manual-first. It does not need email, bank, password,
or browser-extension access to be useful.

## What It Does

- Select interest areas such as family life, meals, shows, design, productivity, dev tools, learning, health, finance, and home projects.
- Complete first-run onboarding for interests, keywords, source comfort, alert cadence, and minimum trial value.
- Browse unreviewed starter entries and live admin-approved offers, with source and pricing details.
- As the verified Google owner, review evidence, approve/publish, reject, or withdraw offers at `/admin.html`.
- Build a requirement-first try plan, such as "cheapest way to watch live sports" or "meal kits for busy weekdays."
- Add a trial as an experiment with a goal, decision date, monthly value, and keep criteria.
- Review active trials before they convert using a practical checklist.
- Inspect the source radar and alert plan that a backend collector can use later.
- Generate a local optimization plan based on active trials and decisions.
- Export or copy your try plan without creating an account.
- Sign in with Google to save plans, interests, preferences, and decision history across devices.
- Import a guest plan or JSON backup into your account without replacing existing records.

## Privacy Model

Guest plans stay in browser `localStorage`. Signed-in plans are stored privately
in Cloud Firestore under `users/{uid}/plans/default`. Account edits do not replace
the guest plan. Importing the guest plan is an explicit action after sign-in.

```text
Manual only       On by default
Email forwarding  Future optional import path
Bank scan         Not part of the MVP
```

Google sign-in uses session persistence. Firestore uses an in-memory cache, and
unsaved account changes require keeping the page open or exporting a backup.
The app displays save failures and detects conflicting changes from another device.
Alerts are not implemented. A separate Mac-based nightly collector monitors two
reviewed official sources and uploads unverified candidates to a private review
queue; it does not automatically update the public catalog or user plans.

See [ACCOUNT-STORAGE.md](ACCOUNT-STORAGE.md) for the data model and test coverage.

## Hosted Tester Release

The hosting target is https://trywise-9f8e1.web.app (same site at
https://trywise-9f8e1.firebaseapp.com). Custom-domain naming and DNS are separate.

To publish runtime files only:

```sh
rtk npm run deploy
```

The predeploy build copies 15 explicitly listed runtime files into `dist/`.
Tests, development skills, debug logs, database rules, and backend scaffolds are
not published. Database rules and Google sign-in are deployed separately with:

```sh
rtk proxy npx -y firebase-tools@latest deploy --only firestore,auth --project trywise-9f8e1
```

Tester journey: sign in with Google, add an offer, edit its goal, wait for the
account button to show a checkmark, then sign in on a second device. Use Import
guest plan if you started without signing in. Feedback should include the page,
action, expected result, and what happened, without sharing private plan content.

## Backend And Extension Path

For approval instructions and admin access, see [PUBLISHING.md](PUBLISHING.md).

The repo includes a working Mac collector and scaffolds for later discovery paths:

```text
backend/
  nightly.py          Scheduled policy-gated collector and durable outbox
  upload-nightly.mjs   Create-only private Firestore uploads
  nightly-sources.json Reviewed sources used by the nightly job
  NIGHTLY.md          Schedule, review report, credentials, and operations
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
firebase-config.js          Public Firebase web configuration
firebase-client.mjs         Google sign-in and Firestore adapter
plan-store.mjs              Account isolation, save queue, and conflict handling
plan-state.mjs              State validation and import merging
account-ui.mjs              Account controls and save feedback
assets/trywise-mark.svg  Local visual asset
backend/                    Nightly collector and discovery scaffolds
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

See [backend/NIGHTLY.md](backend/NIGHTLY.md) for the installed 3 a.m. Chicago
schedule, catch-up behavior, and stop/resume commands.

```bash
rtk proxy python3 backend/nightly.py
rtk proxy python3 backend/nightly.py --status
rtk proxy open backend/data/nightly/review.html
```

Generated files are written under `backend/data/` and are intentionally ignored by
Git.

## Test

Backend safety tests:

```bash
rtk proxy python3 -m unittest discover -s backend -p 'test_*.py'
rtk proxy node --test tests/nightly-upload.test.mjs
```

Optional browser journeys require Playwright and a local server:

```bash
npm install
python3 -m http.server 4177
npm run test:smoke
npm run test:journeys
npm run test:ux
npm run test:storage
```

For account and rule tests, start the Auth/Firestore emulators in the demo project
with `rtk npm run emulators` (requires Java 21+), keep the local web server running,
then run `rtk npm run test:rules` and `rtk npm run test:accounts`. The browser account
test refuses to create test users outside the local `demo-trywise` project.

See [UX-REVIEW.md](UX-REVIEW.md) for the usability findings, implemented improvements,
verification scope, and recommended next work.

The current catalog links were checked for reachability and trial/pricing/offer
signals. MasterClass blocks scripted checks, so the app marks that link as
browser-check-required instead of fully verified.

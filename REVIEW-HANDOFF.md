# Rocky review handoff — MVP planning UX

Branch: `codex/mvp-planning-ux`. Base: `7597e6d` on `main`.
Status: awaiting Rocky's exact-commit review and Sohan's verdict. **Do not merge
or deploy this branch to production without that verdict.**

## Working agreement

- Codex implements a coherent, bounded change and pushes small commits to
  `codex/<description>`. Rocky critiques; Sohan relays the decision.
- Reviews identify the exact head SHA and base SHA. Approval of an older SHA
  does not approve subsequent changes. CI must pass for the reviewed head.
- Correctness, security/privacy, broken tests, and scope creep are blocking.
  Style, naming, and optional refactors are advisory unless tied to a defect.
- Every finding gets either a fix plus regression evidence, or an explicit
  reasoned response for Sohan to decide. Never silently dismiss a finding.
- After approval, merge and verify the exact deployed revision. A successful
  upload alone is not a successful release. No credentials in review artifacts.

## Scope of this branch

1. Loading/error states no longer masquerade as an empty catalog. Retain the
   saved plan if the catalog is unavailable; offer an explicit reload action.
2. Put saved options before the tracking form on mobile and desktop. Restore
   provider access from a saved option when it remains in the catalog.
3. Quick-start searches preserve the user's budget instead of inserting $30/$80.
4. Compare 2–3 saved options using reviewed catalog facts. Unreviewed or missing
   fields stay unknown, never inferred as free. Comparisons are session-only and
   clear on account changes, reload, or removal. No preference/plan schema change.
5. Export a confirmed active decision date as an all-day `.ics` event. Include
   the option name/date, not goals, notes, account identity, or a private-plan URL.
   The user imports the file and configures reminders in their calendar app.
6. Preserve cents in the tracked monthly-cost summary.

No production catalog approvals, collector expansion, automated notifications,
new analytics, IAM changes, or Firestore rule changes are part of this branch.
The deployment identity setup and live-test readiness fix were completed on
`main` **before** the new review gate. That release passed all CI/live checks.

## Evidence and tests

- Live mobile/desktop guest audit found a loading/empty-state flash, a tracking
  form above the shortlist, and silent quick-start budgets. No real accounts or
  production plans were created or modified.
- 33 model/unit tests pass, including reviewed-vs-unknown costs, calendar date
  validation/leap days/year rollover, escaping, UTF-8 line folding, and omission
  of private notes.
- Local consumer browser checks cover 2–3 item selection/limit, removal/undo,
  modal Escape/focus restoration, hostile text escaping, responsive comparison,
  guest persistence, download contents, preserved budgets, and deterministic
  catalog loading/failure/recovery.
- Existing smoke, eight discovery journeys, 71 contrast checks, keyboard checks,
  and 320/390/768/1440 layouts pass locally. Build allowlist/hash checks pass.
- Account tests add sign-out with an open private comparison. Full demo-emulator
  checks run in branch CI; local execution is unavailable without a Java runtime.
  Require branch CI success before approval.
- Reproduce: `npm ci`, start a localhost server on port 4177, run `npm run
  test:unit`, `node tests/consumer-browser.mjs`, `npm run test:smoke`, `npm run
  test:journeys`, and `npm run test:ux`. CI also runs the demo Auth/Firestore suite.
- Browser tests write `trywise-mvp-plan-mobile.png` and
  `trywise-mvp-comparison-mobile.png` to the platform temp directory. Screenshots
  use test fixtures, not real account data.

## MVP blockers for Rocky's prioritized issue backlog

### P0 — Freshness and honest availability

The public catalog on September 27 contained 35 options, only 2 admin reviewed.
Both reviewed entries were dated September 9 (18 days old). “Admin reviewed” is
historical evidence, **not** proof the terms still hold. This branch does not
solve freshness; it must not be presented as a public-launch-ready catalog.

Acceptance criteria for the next bounded work item:

- Define an explicit, configurable maximum age for reviewed evidence and the
  recheck cadence. Time-limited promotions may require a shorter policy than
  stable free tiers. Agree on thresholds before calling them a guarantee.
- Track attempted checks separately from successful evidence verification.
  HTTP 200, HTTP 304, and an LLM extraction are not fresh confirmation of terms.
- Expired/withdrawn offers cannot remain recommended, searchable as active, or
  purchasable via stale shortcuts. Age-expired evidence loses current confidence.
- Never delete a user's saved/started plan when an offer dies. Explain the
  changed availability, preserve confirmed dates, and guide the next decision.
- Exercise time-boundary, missing/invalid/future-date, blocked-source, reappearing
  offer, and cached-client cases. Alert admins when verification misses its SLA.
- Keep publication moderated and source evidence inspectable. Broken-source
  collection must fail closed; do not bypass robots/access restrictions.

### P0 — Reliable track → remind → decide

Calendar export is a bridge, **not** an automatic reminder service. No alert
delivery, calendar synchronization, or subscription cancellation is promised.
Files may appear in the user's downloads and chosen calendar; treat both as
user-controlled data destinations. Re-import/update behavior varies by app.

Acceptance criteria for a real reminder work item:

- Explicit opt-in, channel and timezone choice, consent/withdrawal, and a date
  before the user's confirmed conversion or decision deadline.
- Idempotent scheduled delivery, retries, failure visibility, and no delivery
  after cancellation/account deletion. Editing a date supersedes old schedules.
- A test delivery and observable sent/failed status; no claim of delivery based
  only on a queued job. Cover DST, missed runs, duplicate invocations, and edits.
- Opening a reminder leads to the right private plan, with sign-in as needed;
  keep/cancel-planned/extend outcomes remain honest about provider actions.

### P1 — Tester validation and scoped coverage

- Choose the first audience and curate a small, current reviewed selection.
  Expand only as fast as verification can sustain; collector volume is not KPI.
- Moderated community submissions need evidence, duplicate handling, abuse
  controls, and review, not automatic public writes.
- Ask 5–8 testers to find a relevant option, explain its costs/catches, compare,
  save/start, set a reminder, and record a decision. Automated tests cannot prove
  retention or desirability. Measure successful decisions, not time-on-site alone.
- Performance thresholds need a separate reproducible mobile lab check and
  eventually real-user measurements. No Core Web Vitals pass is claimed here.

Reference principles: [usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/),
[WCAG target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
[Web Vitals](https://web.dev/articles/vitals), and
[iCalendar format](https://www.rfc-editor.org/rfc/rfc5545).

# Mobile release budgets

Run `npm run build && npm run test:performance` after installing Playwright's
Chromium. The script serves the exact `dist/release.json` allowlist over a
loopback-only server with gzip, as Hosting compresses text responses. It runs
pinned Lighthouse 13.5.0 with its mobile viewport and simulated mobile network /
CPU defaults. It does **not** disable Firebase, intercept SDKs, replace catalog
data, or use an audit-specific application path. It reads the public catalog as
a fresh guest; it never signs in or changes production data.

## Blocking thresholds

| Measure | Maximum / minimum |
| --- | --- |
| Lighthouse mobile performance | at least 90 |
| Automated accessibility score | 100 |
| Largest contentful paint | 3,000 ms |
| Total blocking time | 200 ms |
| Cumulative layout shift | 0.1 |
| All first-party release files, individually gzipped | 100 KiB total |
| Entry HTML, gzipped | 35 KiB |
| Starter catalog, gzipped | 10 KiB |
| Any first-party runtime file, raw | 180 KiB |

Visible provider-link labels must also be included in their accessible names,
even though Lighthouse currently does not weight that check in the category
score. Unit tests deliberately exceed each size limit to verify that a regression
fails. CI runs both the budget tests and the real compressed-release audit.

The live Firebase SDK transfer and its effects on LCP/TBT are included in the
Lighthouse run, not in the first-party compressed-asset sum. Network outages can
fail the audit; inspect the failure before rerunning. Do not raise a budget to
make an unexplained regression green.

## Streaming and readiness

Firestore keeps its Listen channel open after loading. Lighthouse 13 can wait
until its navigation timeout for this critical request to finish. The harness
keeps the warning in the report and accepts it only if the trace proves that
**every** unfinished request is the exact Firestore Listen endpoint, and the
same audited page shows the live cloud catalog, rendered cards, and an
interactive main region. Other warnings, missing content, and audit errors fail.
This qualification is not a waiver for a slow or broken application.

Only aggregate scores, metrics, audit IDs, and asset byte counts are written to
`.audit-results/mobile.json`; raw network URLs, session identifiers, catalog
records and user plans are not archived. CI retains this report for 14 days.
Audit artifacts, tools and development dependencies are not deployed.

## Growth and manual checks

The small starter module has its own CI size ceiling. Public Firestore uses a
live snapshot listener: after its initial read, changes are delivered through
the existing listener, not through repeated full-catalog polling. The current
catalog capacity is 500 documents / 1 MiB decoded JSON. The listener reads a
501st sentinel and rejects oversized/truncated snapshots before exposing them;
the UI reports catalog unavailability rather than presenting a partial result.
This is a capacity guard, not infinite scalability. Moving beyond it requires explicit
pagination that also preserves withdrawal tombstones and search completeness.
Never silently truncate a response or resurrect an omitted seed offer.

Lighthouse's simulated score is not a real-device field measurement or a full
accessibility audit. Keep the 320/390/768/1440px interaction, keyboard focus,
contrast, and date-picker tests, and continue manual phone/screen-reader checks.

References: [Lighthouse programmatic API](https://github.com/GoogleChrome/lighthouse/blob/main/docs/readme.md),
[Firebase Auth dependency initialization](https://firebase.google.com/docs/auth/web/custom-dependencies).

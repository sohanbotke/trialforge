# Nightly collection on this Mac

Installed September 8, 2026. The collector writes **unverified review records**,
not published offers. The collector does not change the website catalog or any
existing user plan. The owner now has a separate [approval workflow](../PUBLISHING.md).

## Local AI approval drafts

The collector now uses the already-installed `qwen2.5:7b-instruct-q4_k_m` model
through Ollama at `127.0.0.1:11434`. FCC is not modified or used: its current
model list exposes no local routes. No model downloads, API keys, cloud inference,
or automatic publication are enabled. Ollama must be running when collection runs.

Only the fetched public page text goes to the model. No Firebase credentials,
private review notes, plans, tools, or browser access are provided. The connection
is a fixed loopback socket, bypassing HTTP proxy environment variables; redirects
and remote/cloud model markers are rejected. Model output cannot choose endpoints.

Extraction is capped at two model attempts per run, 55 seconds per generation,
16,000 input characters, 1,800 output tokens, and an 8,192-token context. The model
is kept loaded for one minute. Successful drafts are cached by source version and
model/extractor version. The existing five-minute collector watchdog still applies.
Use `python3 backend/nightly.py --no-drafts` to skip inference for a manual run.
If Ollama is missing, slow, or returns invalid output, ordinary collection continues
and drafting is retried on the next collection. No model is automatically pulled.

The model selects numbered evidence excerpts; the collector attaches the original
text, validates field types/ranges, and discards unmatched evidence, unsupported
numeric pricing, and detected free/paid-plan conflicts. These checks do not prove
semantic correctness. Region, cancellation, upfront costs, and other unknowns stay
blank. Expiry is not extracted. Manual official-terms review remains mandatory.

A successful draft is a new immutable pending candidate in the existing private
`candidates` payload envelope. Its deterministic ID references the original via
`draftParentId`; no previously approved record is modified. One initial pair of
AI drafts appears alongside the earlier approved raw discoveries. Drafts do not
change the public catalog until approved. Repeated unchanged runs reuse the same
draft ID, preventing duplicate drafts. The existing collector permissions suffice;
no Security Rules or IAM changes are needed.

Open **Nightly discoveries** on the admin page. Unreviewed AI candidates prefill
suggested fields even when updating an existing catalog target. Check the warning
panel and field-by-field evidence; missing values must be completed manually.
Reapplying a draft asks before replacing edits and unchecks approval confirmation.
Signing out clears drafts and evidence from the UI. The hosted browser never calls
Ollama directly; extraction runs on this Mac and only the private results sync.

Tests: `python3 -m unittest discover -s backend -p 'test_*.py'`,
`node --test tests/draft-fields.test.mjs`, and `node tests/admin-browser.mjs`.

## Nightly schedule

- LaunchAgent: `com.trywise.nightly-collector`, installed for macOS user 502.
- Collection: once a day at/after **03:00 America/Chicago**, including DST.
- The local 03:00 calendar trigger is backed by a 15-minute local check. This
  catches up after wake/login or a timezone change; no source requests are made
  by checks when collection is not due. Manual tests do not consume the nightly slot.
- An ordinary wake can catch up the missed run. The job does not wake the Mac,
  run while powered off, or run while this user is logged out. After login it
  catches up the current day when it is after 03:00, not every missed historical day.
- Failed uploads retry at most hourly while this user session is available.
  Source failures are recorded for review and checked again the next night.
- No Cloud Functions, Cloud Scheduler, or billing upgrade was enabled.

The installed plist is in `~/Library/LaunchAgents/com.trywise.nightly-collector.plist`.
Its checked-in copy is `scripts/nightly.launchagent.plist`. Both contain this Mac's
absolute Python, Node, and repository paths. Update/reload the plist if moving the
project or removing Node v26.7.0. Changing the template alone does not reinstall it.

## Everyday commands

From `/Users/sohan.botke/Workspace/trialforg`:

```sh
rtk proxy python3 backend/nightly.py --status
rtk proxy python3 backend/nightly.py
rtk proxy python3 backend/nightly.py --local-only
rtk proxy python3 backend/nightly.py --upload-only
rtk proxy open backend/data/nightly/review.html
```

The report shows the latest source evidence, attribution, and source failures.
Candidate versions are archived under `backend/data/nightly/reviews/`.
`latest.json` contains the latest collection; `outbox.json` contains uploads not
yet acknowledged. A successful upload leaves an empty outbox. Never delete the
outbox to fix a network/authentication problem. All these files are excluded from
Firebase Hosting and version control.

Inspect or stop the schedule:

```sh
rtk proxy launchctl print gui/502/com.trywise.nightly-collector
rtk proxy launchctl bootout gui/502/com.trywise.nightly-collector
```

Resume the installed schedule:

```sh
rtk proxy launchctl bootstrap gui/502 /Users/sohan.botke/Library/LaunchAgents/com.trywise.nightly-collector.plist
```

Logs are in `~/Library/Logs/TryWise/`. There is no email/push failure notification
in this release; check `--status` and the logs. The 15-minute idle checks are silent.

## Source policy and limits

Only `nightly-sources.json` is used; the older scaffold's `sources.json` is **not**
automatically enabled. The two starter sources are:

1. GitHub Copilot plans, retrieved through the documented
   [GitHub Docs API](https://docs.github.com/en/get-started/using-github-docs/github-docs-api).
   [Documentation license](https://github.com/github/docs#licenses): CC-BY-4.0.
2. Cloudflare Workers pricing, retrieved as official Markdown documentation.
   [Documentation license](https://github.com/cloudflare/cloudflare-docs/blob/production/LICENSE): CC-BY-4.0.

Every enabled source needs a documented policy review, HTTPS hostname allowlist,
canonical offer URL, and attribution. Reviews expire after 90 days and fail closed
until genuinely reviewed again. Do not just advance the review date automatically.
Commercial pages, submissions, and arbitrary discovered URLs are not crawled by
this job. YNAB was deliberately excluded after its terms prohibited automated access.

Each run honors robots.txt (including conservative wildcard denial), crawl delays,
and request rates, with at least two seconds between same-host requests. Robots
403/429/5xx, redirects, or invalid responses fail closed; a 404 means no robots file.
There are no login cookies, bot-protection workarounds, proxies, or AI API calls.

Limits: 30 total requests, 2 MB per response, five redirects, 15-second socket
timeouts, and a five-minute total run deadline. Redirect hosts must also be approved;
all DNS answers must be public, and the validated address is pinned to the socket.

## Review and Firestore model

- `candidates/{hash}`: immutable candidate versions, status `pending_review`,
  verificationStatus `unverified`, URLs, up to six evidence excerpts, attribution,
  policy review date, categories, observation time, and full normalized page hash.
- `crawlRuns/{runId}`: collection results and the IDs observed in that run. A
  collection success is not an offer verification and does not imply upload success;
  consult the local outbox for upload status.
- Stable content hashes deduplicate unchanged versions. A changed page produces a
  new review version, even if its visible excerpts are unchanged. This can include
  non-price edits; human review is intentional. A missing keyword or failed fetch
  never automatically expires an existing offer.
- The collector does not infer trial duration, renewal cost, eligibility, or
  cancellation deadlines from keywords. Free plans and trials still need distinction.
- The source list monitors two known provider pages. It is not yet an unrestricted
  discovery crawler; add reviewed sources deliberately to expand coverage.

Review and publish at https://trywise-9f8e1.web.app/admin.html using the verified
owner Google account. The local report remains useful for collector diagnostics.
Setting a raw candidate status in the Console is not the publishing workflow:
the admin page atomically writes a private decision and sanitized public offer.
No redeploy is needed. The collector never resets a reviewer's decision.

## Credentials and security boundaries

The writer now uses Firebase Auth UID `trywise-nightly-collector`, a `collector`
claim, and the custom-auth provider. Firestore rules allow this identity to
**create only** in `candidates` and `crawlRuns`. It cannot publish, approve,
read private reviews/plans, or edit/delete existing records. Public catalog reads
are available to everyone. New records contain a bounded `payloadJson` envelope;
the approval UI also supports the original raw candidate format.

The credential is an owner-only (0600) refresh-session file at
`~/Library/Application Support/TryWise/nightly-session.json`, inside a private
0700 directory outside the repository. The app does not encrypt this file; protect
this Mac and enable FileVault. Do not share, commit, or paste the credential.
Runtime verifies its ownership, permissions, expected UID, project, and claim.
It refreshes short-lived Firebase ID tokens without using your Firebase CLI login.

The former `trywise-nightly@trywise-9f8e1.iam.gserviceaccount.com` service account
is **disabled** and its project IAM binding has been removed. Its old key file is
retained privately but obsolete. The old IAM setup's apply command is disabled;
do not restore project-wide permissions. This removes the earlier collection-scope
limitation that could have allowed a compromised collector key to create catalog
documents directly.

To revoke collector access, disable the dedicated Firebase Auth user/revoke its
refresh tokens, then stop the LaunchAgent. An expired/revoked session leaves
uploads in the local outbox. Renewal requires an operator-provisioned collector
session, never an admin password or an enabled public password/anonymous provider.
See `scripts/migrate-nightly-auth.mjs` for the migration record; its legacy key
cannot mint another session after retirement.

## Tests

```sh
rtk proxy python3 -m unittest discover -s backend -p 'test_*.py' -v
rtk proxy node --test tests/nightly-upload.test.mjs
rtk proxy node tests/firestore-rules.test.mjs
rtk proxy node scripts/verify-nightly-access.mjs
```

The rules test requires the local Firestore emulator. The access diagnostic uses
the live collector key against its own candidate, with impossible update-time
preconditions on mutation probes. It does not touch user plans. Unit tests cover
source policy expiry, robots denial, private-network blocking, deduplication,
Chicago/DST timing, HTML escaping, uploader path restrictions, and retry semantics.

Release verification: 18 Python tests and four uploader tests passed; 51 malformed
or unauthorized client operations were denied in the emulator. Live create-only
uploads succeeded, live read/update/delete probes were denied, and a second
collection reported zero new versions with zero pending uploads. The installed
LaunchAgent was started explicitly and exited with code 0. The public hosting build
now includes 15 runtime assets, excluding every collector file. Publishing tests
add 58 denied attacks and admin browser coverage; see PUBLISHING.md.

The September 9 admin restructuring groups related raw/AI discoveries with
collapsed history and explicit offer identity checks. The 35-entry source audit
did not expand the crawler allowlist, grant approvals, or change this schedule.
Collection still writes private candidates only; publication remains owner-only.

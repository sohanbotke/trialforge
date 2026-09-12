# Account storage and tester release

Project: `trywise-9f8e1`. Database: `(default)`, Standard edition, `us-central1`.
Provisioning returned `freeTier: true`. No billing upgrade, Functions, file storage,
or Analytics was enabled by this implementation. Google sign-in and Firestore rules
were deployed on September 7, 2026. Website hosting is configured for the default
Firebase domains; a custom domain is not required for tester access.

The tester website was deployed on September 8, 2026 at
https://trywise-9f8e1.web.app. The publishing release now includes 15 allowlisted runtime assets.

## Stored data

Each Firebase Authentication UID owns one private workspace document at
`users/{uid}/plans/default`. It stores a versioned snapshot of saved trial options,
goals, checklists, requirements, decision history, interests, and source/alert
preferences. The public catalog combines explicitly unreviewed bundled starters
with admin-approved Firestore overrides and withdrawn tombstones.

The snapshot is a bounded JSON string inside a typed envelope containing
`schemaVersion`, `revision`, and a server `updatedAt` timestamp. This gives the
current small app atomic updates with one document per account. It is not intended
for server-side queries over individual trial records. Split records into separate
documents when scale or query requirements warrant it; the client currently caps
the snapshot at 750 KB.

## Saving and recovery

- Firestore rules check ownership against the authenticated UID in the document
  path. There is no user-editable role or owner field.
- Reads and writes are limited to that account's `default` plan. Collection
  enumeration, anonymous access, nested documents, and document deletion are denied.
- Transactions compare revisions before saving, preventing silent replacement of
  newer changes from another device. The user can export edits before loading latest.
- Account state is loaded from the server. An unsuccessful read never falls back
  to another account's data or uploads the guest plan automatically.
- Failed saves retain the pending state in memory, show an error, and warn before
  leaving the page. Retry saves when connected again. Offline browser closure is
  not a durable queue; export before leaving if saving fails.
- Guest storage remains separate. Import adds missing records, deduplicates trial
  catalog IDs, and preserves existing account records/preferences. It is repeatable.
- Sign-in sessions are scoped to the browser session. Refreshing a page preserves
  the session; signing in on another device loads the same server data.

## Verification and limits

`test:storage` verifies account isolation, delayed account reads, serialized saves,
retry after failure, concurrent-edit protection, remote update locking, and imports.
`test:accounts` exercises the real Firebase Web SDK with the Auth/Firestore emulators
in two independent browser contexts. It covers guest import, saving, cross-device
updates, reload persistence, sign-out, and an empty second account.

`test:rules` verifies successful owner access and 31 denied operations, including
cross-account reads/writes/deletes, anonymous access, enumeration, extra/nested
documents, extra fields, invalid envelope types, oversized strings, fake timestamps,
and skipped/replayed revisions. The deployed rules also passed Firebase compilation.

The snapshot JSON is opaque to rules. Client validation rejects malformed content
on save/load/import, but an authenticated owner using a custom client could corrupt
their own JSON. This does not grant access to another account. These prototype rules
need continued review before broad public use. See `SECURITY-REVIEW.json`.

The existing website smoke, recommendation, responsive-layout, keyboard, and
targeted contrast checks remain available. Google credential entry is not automated
against the live production project; tester sign-in is the final human check.

`test:hosted` passed against the public HTTPS address after deployment. It verified
runtime asset delivery and JavaScript MIME types, guest-plan persistence after
reload, the real Google sign-in popup reaching `accounts.google.com`, mobile layout,
and 404 responses for development files. It did not create production accounts or
write production plan data.

Automatic reminders, provider cancellation, and fresh offer verification are not
implemented by account sync. Saving an alert preference does not schedule delivery.

The separate Mac nightly collector now creates private, unverified `candidates`
and `crawlRuns` records. It does not modify personal plans or publish offers.
Guests and ordinary testers cannot access these collections. Only the verified
Google owner can review and publish via [the approval workflow](PUBLISHING.md).
The nightly writer now uses collection-scoped Firebase Auth rules, with its old
project-wide IAM identity disabled. See [backend/NIGHTLY.md](backend/NIGHTLY.md).

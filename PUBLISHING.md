# Approving and publishing offers

Open https://trywise-9f8e1.web.app/admin.html and sign in with Google as
`sohan2405@gmail.com`. You can also use **Account → Review & publish offers** from
the main website after signing in. Access requires that exact verified email and
the Google sign-in provider; other accounts, unverified tokens, password sign-in,
and custom-token sessions cannot administer the catalog. No admin role is stored
in an editable profile or localStorage. The owner did not have a Firebase Auth
user at setup time; the authorized Google sign-in will create it normally.

## Workflow

### First batch published

On September 8, 2026 (America/Chicago), the owner requested one-time automatic
approval of the first collected batch. GitHub Copilot Free and Cloudflare Workers
Free were checked against their official documentation and published, replacing
their matching starter entries. They are free tiers, not paid-plan trials; the
14-day interval is a personal review reminder. Regional eligibility still needs
confirmation at signup.

The two catalog records and their private approval records committed atomically
at `2026-09-09T00:05:58.666767Z`. This operator action used the existing owner CLI
IAM login, not a fabricated Firebase user session. Private audit records identify
the actor as `operator:sohan2405@gmail.com` and explain the assistant review.
The bounded `scripts/publish-first-batch.mjs` refuses to overwrite existing records
or run outside the authorization date. It is not included in the hosted build.
No rules, collector permissions, nightly approval policy, or user plans changed.
All other starter entries remain unapproved; future discoveries require approval.

### September 9 restructuring and starter audit

All 35 starters now have official-source audit notes in the admin editor and
`starter-audit.mjs`. This is a source/classification audit, **not complete commercial
terms verification or new approval**. Two entries had prior approvals; 33 still
need approval. Some signup pages were unavailable or did not expose usable prices.
Check regional checkout terms manually before publishing. No production offers,
private review decisions, or saved plans were rewritten by this restructuring.

The nightly queue groups related versions, shows the newest pending evidence,
and collapses older/raw/AI versions into history. A reviewed raw/draft family does
not appear as a second pending offer. Use the pending filter and load older pages
to include more history. Grouping is a review aid, not an automatic semantic merge;
an unfamiliar source or separately named plan can remain a separate group.

Every new publication requires explicit lowercase identity identifiers for
provider, product, plan, region, and eligibility/promotion scope. Offer type and
USD currency complete the canonical key. Use consistent identifiers (`us`, for
example), not model-generated guesses. Different billing terms that define a
distinct plan should have distinct plan/scope identifiers.

Exact identity matches must update the existing offer ID. Similar names, provider/
product/plan combinations, and normalized URLs trigger advisory warnings and an
**Update existing offer** action. Only tracking parameters are removed from URLs;
plan, promo, region, language, price filters, referral parameters and fragments
remain meaningful. A genuinely different variant needs its own identity and an
explicit distinct-variant confirmation. These checks do not detect every alias
or prove that two differently entered identities are semantically distinct.

Publication atomically claims a private `offerKeys/{identityKey}` record with the
catalog and review. Claims are immutable, preventing simultaneous exact duplicates.
Identified offers keep their key after withdrawal and cannot reuse their ID for
a different identity. Existing legacy listings remain readable and acquire their
identity on their next real approval; they were not bulk-migrated or reapproved.
Reload an old admin tab before submitting under the new rules.

### Ongoing manual review

Nightly discoveries can now include **AI draft — not verified** suggestions from
local Ollama. These prefill the form with bounded, evidence-linked fields; unknowns
stay blank. Expand the source excerpts and check every term. The model can still
misinterpret a page or mix plans, even when an excerpt matches. Review warnings
and do not treat the draft as verification. Applying draft fields clears the
approval checkbox and never publishes. Existing published listings stay unchanged
until you explicitly approve. See [local drafting details](backend/NIGHTLY.md).

1. Choose **Nightly discoveries**, **Existing starter catalog**, or
   **Published / withdrawn**. Load more discovery pages as needed.
2. Select an entry and open its official source. Evidence snippets are untrusted
   collection signals, not verified prices or eligibility.
3. Confirm/edit its name, description, URL, category, offer type, actual trial
   duration, upfront/base cost, billing details, eligibility, region, cancellation,
   goal, and optional expiry. This version supports USD offers only.
4. Reuse an existing **Offer ID** when updating that offer. Click **Check / load
   offer ID** after changing the ID. Separate plans/regions should use
   separate IDs; do not merge a paid trial and a permanent free tier accidentally.
   Complete the identity fields and resolve duplicate warnings before confirming.
5. Check the confirmation box and click **Approve & publish**, then confirm.
   Visitors receive the reviewed offer through Firestore without redeployment.

The current collector's two source IDs default to the matching GitHub Copilot and
Cloudflare Workers starter IDs to make replacements straightforward. You still
must distinguish the specific plan being offered. Pricing, eligibility, and all
other required terms must be completed by you; nothing was bulk-approved at setup.

**Reject candidate** requires a private note and does not publish or withdraw
anything. To remove an already-public offer, use **Published / withdrawn → Withdraw**.
An expired offer is hidden on load and within a minute on an open page. The saved
plan on a user's account remains a snapshot; neither publishing nor withdrawal
changes personal costs, deadlines, goals, or other edits.

Existing starter entries remain visible for testers but are explicitly labelled
**Review needed**. Publishing the same ID overrides its starter details. A
withdrawn record leaves a minimal public tombstone so the starter does not return.
Tombstones contain ID, status, schema version, revision, update time, and the
canonical identity key when the listing has one.
Do not delete tombstones in the Console unless intentionally restoring a starter.

## Saving and review privacy

Private notes, reviewer UID, raw candidate evidence, and collection runs are not
stored in public catalog documents. Catalog writes and private approval decisions
commit in one transaction. Revisions protect against stale tabs and concurrent
updates: reload a conflicted review/target rather than repeatedly submitting it.

Unsubmitted admin form edits are kept only in memory. Leaving or changing the
selected candidate warns before discarding them. **Keep draft in this tab** parks
up to ten reviews in memory so you can switch work and resume them. It does not
write to Firestore, localStorage, or sessionStorage. Refreshing, closing the tab,
or signing out clears these drafts; leaving warns while drafts remain. Resumed
drafts retain their original revision checks and never retain approval confirmation.
Signing out clears the editor, private queue, drafts, and evidence. Durable draft
storage and cross-device draft synchronization are not included.

## Admin usability and correctness follow-up

The September 9 follow-up fixes delayed reads overwriting edits, published offers
sharing a candidate being collapsed/retargeted, unrelated variants being hidden
as reviewed, and stale cancellation feedback. Initial loads keep the form hidden
and disabled; target reloads disable editing until settled. Failed reads time out
after 15 seconds with retry guidance; failed decisions keep edits. Decision writes
are not automatically queued or retried when offline.

The queue is searchable over loaded entries, with selected-row highlighting and
preserved expanded history. Desktop uses a bounded queue; mobile switches between
queue and detail with **Back to queue** and **Return to current review**. Details
are organized into four sections with a sticky action bar. Identity inputs for an
identified target are read-only; **Create a distinct variant** releases the form
for a new ID/identity but does not publish anything.
Withdrawn listings reconstruct their locked identity from the retained canonical
key so they can be reviewed and republished under the original identity.

Source excerpts and published-versus-suggested AI values can be compared next to
individual fields and accepted individually. Suggestions still require verification.
Validation links to invalid fields; server errors appear in the editor and beside
the actions. Observed catalog revisions changing during editing trigger a notice,
while the existing transaction remains the authoritative stale-write guard.

Only explicit raw/draft family lineage suppresses pending evidence. A newer review
does not hide older unreviewed observations merely because their source or name
matches. Published rows are keyed by offer ID; a source may support several offers.
Candidate reviews remain current decisions, not an immutable multi-offer audit log.

The additional `AUDIT-REPORT.md` was considered, but its static-only suggestion
that failed publication necessarily discards edits was not confirmed: the previous
transaction already rejected stale revisions and retained the form in its catch
path. Regression tests now cover that behavior explicitly. The existing 500-record
catalog guard remains intentional; scaling the public stream and matching together
is separate work, not an unbounded query change in this release.

The private queue loads 25 records per page and regroups all loaded records.
The public stream currently caps at
500 catalog documents (including tombstones), adequate for this 35-entry tester
catalog but requiring pagination before expansion beyond that bound. Publication
checks a server snapshot of up to 501 documents and stops if that limit is exceeded.

## Data and access model

- `catalog/{offerId}`: publicly readable, strict validated published offer or
  minimal withdrawn tombstone. Only the verified Google owner may create/update;
  client deletion is denied. No pending drafts exist in this collection.
- `candidateReviews/{candidateId}`: private current decision, notes, target ID,
  reviewer UID/time, and revision. Only the owner can read/write. Starter review
  IDs use `seed-<offerId>`; collected versions use their discovery document ID.
- `offerKeys/{identityKey}`: owner-readable, immutable identity-to-offer binding;
  creation requires an atomic valid publication. Guests, testers, and collectors
  cannot read or write these records. Client updates and deletion are denied.
- `candidates/{candidateId}` and `crawlRuns/{runId}`: owner-readable, immutable
  client-side, collector-create-only. New collector documents wrap payload JSON in
  a bounded envelope; older raw documents are still supported by the admin UI.
- `adminAccess/status`: a read-only authorization probe; no role data or document
  setup is required. Only the owner's verified Google session can get this path.
- `users/{uid}/plans/default`: unchanged private-plan model; admin has no special
  access to another user's plan. The dedicated collector UID cannot use plan paths.

Collector hardening was required because its previous create-only IAM role was
project-wide. It now uses `trywise-nightly-collector`, with a `collector` custom
claim and custom-auth provider; rules restrict writes to its two review collections.
The new owner-only credential is `~/Library/Application Support/TryWise/nightly-session.json`.
The legacy service account is disabled and its project IAM binding removed. Its
old private key file is retained outside the repo but is obsolete. Do not re-enable
it or run the retired IAM setup. To revoke collection access, disable the dedicated
Firebase Auth user/revoke its refresh tokens and stop the LaunchAgent.

## Verification

- Existing rules suite: valid owner access and 51 denied operations.
- Publishing suite: valid atomic publication, revision updates, rejection,
  withdrawal/republication, identity claims and races, legacy upgrades, public
  reading, and 58 denied attacks including forged
  admin claims, wrong providers, malformed documents, unpaired publication,
  collector catalog writes, and private-plan access.
- Browser test: simulated Google owner and tester in emulators, evidence form,
  grouped history, pending filter, duplicate update action, source-audit notes,
  publication appearing for a separate guest, withdrawal, rejection, sign-out
  clearing, mobile layout, and byte-for-byte unchanged saved guest plan.
- Existing smoke, recommendation journeys, UX, account sync, and storage tests.
- Live Hosting check validates runtime assets, Google popup entry, guest saving,
  admin sign-in gate, mobile layout, and exclusion of backend/credential-related files.

Production Google credential entry is not automated. Real offer approval remains
a human check. Security Rules are a tested
prototype, not an exhaustive security guarantee; review before broad public use.

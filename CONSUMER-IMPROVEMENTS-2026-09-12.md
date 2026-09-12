# Consumer improvement checkpoint — September 12, 2026

## Implemented

Reviewed-first discovery with visibly separate research previews; unknown pricing instead of starter estimates; removal of unsupported numbered rankings, cancellation-risk defaults, and high-price-as-value scoring; exact reviewed monetary amounts; expandable terms and evidence; a shorter mobile opening; useful reviewed-cost/type/status filters; and a shortlist distinct from started plans.

Saving creates a `saved` trial record with empty start/end dates. Saved records are excluded from deadline queues and recurring-cost summaries. Starting requires explicit dates and expected cost, and cancelling the start form leaves the saved option unchanged. Existing `active`, `keep`, and `cancel` records retain their status and dates. “Cancel” remains a cancellation plan, not proof of provider cancellation.

Private plans remain in the same per-user payload; no Firestore rule change or production data migration is needed for this status. Older client versions do not understand `saved`, so users should reload other open tabs before using the updated client. No existing plan records are automatically reclassified.

The previous “Compare” area is labeled “Plan summary”; it is not advertised as a real product comparison. See PRODUCT-ROADMAP.md for that next slice and the later interest-driven delivery/streaming design.

## Verification

- Consumer unit coverage: reviewed/unknown costs, zero-cost filter, ordering, shortlist validation, import/merge, existing-record preservation, and account storage isolation.
- Local browser fixtures: reviewed-first display, exact decimal prices, safe evidence escaping, filters/empty states, no synthetic trial expiry for free tiers, save/reload/start/cancel flows, and responsive bounds.
- Existing smoke and eight discovery journeys checked with the revised sorting and explicit start flow.
- Responsive/accessibility suite checks keyboard navigation, focus, form validation, undo, setup cancellation, text contrast, reduced motion, and 320/390/768/1440 px layouts.
- Final checks passed: 30 model/storage/identity/upload/draft unit tests; consumer fixture, smoke, eight discovery journeys, and responsive browser suites; demo-emulator account isolation/synchronization; and publishing-security regressions (58 prohibited operations denied).
- Initial mobile comparison: search moved from approximately 798 px to 470 px from page top; feed from approximately 2,036 px to 924 px in the local fixture. Live catalog messages and different records can affect exact positions.

## GitHub and release scope

The supplied GitHub main branch predates the local Firebase/account/admin/collector work. The improvement branch preserves its history and includes the required local source foundation so the uploaded project is self-contained. Private collector output, credentials, logs, installed skills/dependencies, and generated deployment output are excluded.

Uploading the branch does not deploy Firebase Hosting, publish catalog entries, or alter user plans. Provider verification and catalogue expansion remain separate work.

First uploaded checkpoint: `559e73b` on `consumer-improvements`. Follow-up includes visible focus after clearing collapsed filters, deployment-asset coverage, and updated user-facing documentation.

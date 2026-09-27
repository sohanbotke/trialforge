# Catalog correction and freshness handoff — 2026-09-27

## What this change establishes

All 35 research seeds have lost their unsupported numeric trial length, monthly
price and hand-stamped verification date. Unknown eligibility and admin cost
inputs stay unknown/blank, not a fabricated zero. Seeds remain research previews,
not approved offers. The existing offer-type model already distinguishes trials,
free tiers, discounts, guarantees and open-source tools.

GitHub Models is excluded from discovery, including any old published override.
Its official documentation confirms retirement on July 30, 2026. Saved user plans
are retained with an explanation. This is a display safeguard, not a production
database migration or a replacement for withdrawing a retired catalog record.

Published offers are current only with a valid, non-future `verifiedAt` less than
seven days old and a valid future expiry (if supplied). The seven-day window is a
product policy, not a guarantee that provider terms cannot change sooner. Old or
undated records are labeled for recheck; previous prices/types cannot satisfy
reviewed/budget filters or comparison claims. Expired and withdrawn overrides
suppress seed fallback. Open pages refresh status every 30 seconds and on return.

The admin recheck queue and daily GitHub report use this same policy. The scheduled
workflow runs at 10:15 UTC after this branch is merged into the default branch;
GitHub schedules can be delayed. It reads only the public catalog without account
credentials, retains a report for 14 days, and exits 2 when rechecks are overdue
(exit 1 on read/report failure). Neither HTTP success nor this report changes
`verifiedAt`, publishes records, or starts provider accounts. Failure notifications
depend on the repository owner's GitHub notification settings.

## Evidence and report reconciliation

Sohan supplied Rocky's 35-entry audit dated September 27. It is useful review
input, not authority to bulk-publish ambiguous commercial terms. Independent
official-source checks resolve these important exceptions:

- [GitHub Models retirement](https://docs.github.com/en/github-models): retired;
  do not confuse it with GitHub Copilot.
- [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/):
  Workers Free is separate from Workers Paid's $5 monthly minimum plus applicable
  overages. The audit's “no $5/mo” correction should not be imported.
- [AWS Free Tier](https://aws.amazon.com/free/): the new-account Free plan is
  limited by six months or credit exhaustion; do not label the whole plan permanent.
- [Instacart+](https://www.instacart.com/instacart-plus): the advertised 14-day
  trial renews at $99/year. A separate $9.99 monthly option is not evidence that
  this trial renews monthly. Annual payment is not an upfront-free monthly bill.
- [Copilot plans](https://github.com/features/copilot/plans): Free and Pro are
  different plans; a Free listing does not establish that Pro has no trial.

Existing source-audit notes retain their actual September 9 date; only the
independently rechecked GitHub Models note advances to September 27. No other seed
is newly certified by this PR. Missing publicly advertised terms are not proof
that no offer exists. Kindle Unlimited still needs a manual provider check.

## Remaining work / review gate

- Recheck exact provider plan, region, billing interval, eligibility, cancellation
  and expiry in the admin form before publishing corrected terms. The current
  schema needs further work for split credit/free-tier entitlements and structured
  annual billing. Do not force either into a fake monthly trial.
- As of the read-only September 27 check, both public records (Workers Free and
  Copilot Free) were last verified September 9 and are overdue. This PR deliberately
  does not renew their timestamps or modify production data.
- TW-001 is only partially implemented: automatic provider re-verification,
  confidence transitions and evidence-based disappearance handling remain open.
  A blocked request must not automatically mean “gone.”
- Calendar export is the first tester release's reminder option. Browser push is
  a later opt-in phase; current export requires users to configure calendar alerts.
- Rocky must review the exact PR head. No self-merge or deployment bypass.

## Regression evidence

Policy tests cover the exact seven-day boundary, invalid/future/missing dates,
expiry, SDK timestamps, retirement, queue ordering and fabricated seed fields.
Browser fixtures verify offer-ID/badge consistency through snapshot reordering,
explicit costs on every card, same-count aging, saved-plan preservation and
320/390/768/1440px widths. Admin fixtures cover the live recheck queue and blank
starter fields. Daily-report tests cover pagination, read failure and field
allowlisting. Screenshots contain only artificial fixture offers.

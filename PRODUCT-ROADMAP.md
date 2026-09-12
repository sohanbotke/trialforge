# TryWise improvement roadmap

Updated September 12, 2026. Work in small tested commits; push checkpoints to the improvement branch before merging or deploying. GitHub: https://github.com/sohanbotke/trialforge.

## First batch: trustworthy discovery and accurate planning

- [x] Reviewed options first, with a separate unreviewed preview section.
- [x] No numerical ranking, unverified prices, or inferred cancellation-risk/value ratings on offer cards.
- [x] Exact reviewed base/upfront amounts, with unknowns and extra-charge limitations explicit.
- [x] Compact mobile opening, secondary plan utilities, optional budget/filter controls, expandable offer terms.
- [x] Reviewed-cost maximum, reviewed-only, and offer-type filters. Unknown prices do not match a budget filter.
- [x] Saving does not start a trial; explicit dates and monthly cost are required to begin tracking.
- [x] Preserve existing started plans; saved records survive guest storage, import, and account sync.
- [ ] Curate a useful verified selection in two or three use cases. UI changes do not grant approval or verify provider terms.
- [ ] Real side-by-side comparison before starting a plan.
- [ ] Calendar export, then reliable opt-in reminders.
- [ ] Stable public offer/comparison URLs without exposing private plans or notes.

The old cost/deadline-only “Compare” view is now honestly labeled “Plan summary” until real product comparison is available.

## Later: interests and category-specific value

User direction: help someone choose the best option for their interests, and explain short- and long-term value—not just a free trial or a low headline price.

Ask only relevant optional questions after a category is selected. Let people browse without answering or signing in, explain why each question helps, and let them edit or clear preferences. Separate hard constraints from nice-to-haves. Do not assume a user's household, location, or tastes from weak signals.

### Delivery services

Potential inputs: approximate service area, preferred stores, groceries versus restaurant delivery, order frequency, typical basket, household needs, and existing memberships.

Comparison facts: actual local store coverage, minimum baskets, delivery/service/small-order fees, membership price and renewal, promotion limits, pickup benefits, and sourced ratings. Ratings need source, date, review count, and context; ratings of a store are not ratings of the delivery service.

Value scenarios: cost for the user's expected orders in the introductory period and at normal pricing over a longer period. Include membership and per-order fees; distinguish discounts from hypothetical savings. Show assumptions, exclusions such as tips and taxes, uncertainty, and a break-even estimate only when supported. Do not collect precise addresses unless a specific authorized feature requires them.

### Streaming services

Potential inputs: titles/genres, sports/leagues, language, region, tolerance for ads, children’s content, simultaneous viewers, supported devices, and existing subscriptions.

Comparison facts: current regional catalogue or verified title availability, ad-supported/ad-free plan distinctions, live sports restrictions, profiles versus simultaneous streams, household-sharing rules, children’s profiles/controls, downloads, supported devices, and normal renewal pricing.

Value scenarios: useful content during a trial, likely ongoing usage, overlap with subscriptions the user already has, and longer-term spending. Do not equate number of titles with personal value or promise that catalogue availability will remain unchanged. Household rules and stream counts are plan-specific.

### Shared data and explanation foundation

- Separate provider/product, plan, regional offer, and time-stamped evidence. Existing offer identity work is a starting point, not a complete category model.
- Give comparable facts a source, observed date, scope, and known/unknown status; track volatile facts separately from stable features.
- Explain recommendations with matched preferences and tradeoffs. Avoid a universal opaque “value score.”
- Keep extracted AI fields unverified until checked. No invented ratings, stores, catalogue coverage, or savings.
- Clearly label assumed usage and user-confirmed costs; offer side-by-side scenarios rather than guaranteed savings.
- Start with one category and a small verified dataset. Validate usefulness with testers before expanding collection or integrating paid data APIs.

## Validation and release gates

Run consumer model/browser tests, smoke journeys, responsive/accessibility tests, account isolation tests, and relevant security regressions. Check both reviewed fixtures and the all-unreviewed offline fallback. Build through the deployment allowlist; never upload collected data, credentials, debug logs, or installed dependencies.

Observe five to eight testers completing real tasks. Measure finding a relevant option, understanding costs and catches, comparing alternatives, and setting an accurate decision date. Return visits are useful when driven by a real decision or relevant change; daily activity is not the goal by itself.

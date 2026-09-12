# TryWise usability and UX review

Reviewed September 7, 2026. Scope: the local website in `Workspace/trialforg`, including discovery, planning, editing, decisions, preferences, and responsive layouts. Changes are implemented locally; no production deployment was performed.

The main problems were mobile access to the primary task, filters that appeared interactive but ignored user changes, and actions with inadequate recovery. The existing strengths are a visible planner, labeled form fields, optional setup, local data storage, and disclosure that cancellation must happen with the provider.

## Comparison and implemented changes

The review uses [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) for feedback, user control, error prevention, and clear language, and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) for keyboard access, contrast, reflow, and status messages. These are inspection criteria, not a claim of full accessibility conformance or results from user research.

| Priority | Finding | Best-practice comparison | Implemented update |
| --- | --- | --- | --- |
| High | At 390 × 844, the main input started 2,233 px down the page, after the entire sidebar. | Put the primary task ahead of supporting information. | Collapsible interests/privacy on small screens, compact toolbar and summary, shorter introductory copy, and a smaller planner header. The input now fits on the first screen. |
| High | After building a plan, selecting interests could leave results unchanged because filtering used the previous requirement's categories. | Controls should respond predictably and expose the current state. | Filter by the current interest selection; preserve ranking while allowing the entire catalog to be browsed. Added a result count, selected-interest summary, and Clear filters recovery. |
| High | Removing an option immediately lost its goal, dates, and checklist. | Provide user control and recovery from mistakes. | Added Undo removal with restoration of the original record. Multiple removals can be restored in reverse order during the current page session. The notice explicitly describes the reload limit. |
| High | Decision dates could precede start dates; the hidden Cancel edit button could be displayed by CSS. | Prevent errors and show controls appropriate to the current task. | Inline date error, native validity checks, focus on the invalid field, and consistent enforcement of the HTML hidden attribute. |
| High | Tabs and interest chips lacked selection semantics; rerenders could lose keyboard focus. | WCAG 2.1.1, 2.4.7, and 4.1.2 cover keyboard use, visible focus, and control semantics. | Tab/panel relationships, arrow/Home/End navigation, pressed states, focus preservation, a skip link, a named setup dialog, and an accessible trial progress value. |
| Medium | White text on the brighter part of the primary-button gradient and several status colors had weak contrast. | WCAG 1.4.3 requires 4.5:1 for ordinary text; interactive controls also need visible focus. | Solid dark primary buttons, darker status text, stronger form borders and focus rings, clearer disabled styling, larger common controls, and reduced-motion support. |
| Medium | Setup applied suggested defaults even if the user canceled. | Cancel should discard uncommitted changes. | Defaults now populate a draft in the form; only Save updates preferences. |
| Medium | Source and alert labels could imply active monitoring; labels such as “exposure” and “Load into form” were harder to interpret. | Match user language and accurately describe system status. | Plain cost/edit/copy labels; explicit notices that alerts and monitoring are not active; source-selection labels distinguish saved preferences from functioning integrations. |

Additional changes: contextual external-link names with a new-tab cue, an actionable empty plan, a corrected planner toggle label, longer transient feedback, duplicate-add protection, and a browser-data backup reminder.

## Verification

Run a local server on port 4177, then:

```sh
rtk npm run test:smoke
rtk npm run test:journeys
rtk npm run test:ux
```

- Existing smoke workflow: passes.
- All eight existing recommendation journeys: pass.
- UX regression checks: cover desktop sidebar placement, skip link and tab keyboard navigation, filtering after a plan, empty-result recovery, removal/undo and reload persistence, invalid-date recovery, canceling suggested defaults, responsive layouts, dialog bounds, and reduced motion.
- All five views checked for horizontal page overflow at 320, 390, 768, and 1440 px.
- Ordinary text contrast checked on rendered enabled primary buttons and green/amber/red status badges; all checked combinations meet 4.5:1. This is a targeted check, not an audit of every color combination.
- Desktop and mobile screenshots inspected in Chromium. Real assistive-technology testing and Safari/mobile-device testing remain outside this review.

## Recommended next work

1. Clarify the budget contract: distinguish an explicit $0 from an omitted budget, and decide whether the budget is a strict filter or a ranking preference. The current ranking treats zero as unspecified. This needs coordinated copy and ranking changes.
2. Add explicit provider cancellation confirmation and reversible decisions. “Mark cancel planned” currently removes the trial from the active queue before external cancellation is confirmed; extending a decision date does not extend the provider's trial.
3. Improve local-data resilience with import/restore and recoverable storage-error handling. Export is available, but browser storage can be cleared or unavailable.
4. Test the updated planner with representative first-time users and a screen reader. Measure whether people can find an offer, understand its later cost, and recover from a mistake. Validate offer freshness separately: this UX review did not reverify catalog prices or eligibility.

# Collaboration and release gate

- Work only on branches named `codex/<short-description>`.
- **Never push to `main` or merge a PR yourself.** Sohan controls merging.
- Open a PR for each coherent unit with these sections: Scope, Tests (commands
  and actual results), Screenshots (for UI changes), and Known gaps.
- Rocky is the reviewer. Wait for his PR review of the exact head SHA:
  APPROVE or REQUEST CHANGES with inline comments.
- Correctness, security/privacy, broken tests, and scope creep are blocking.
  Style, naming, and optional refactors are advisory.
- For REQUEST CHANGES, fix on the same branch, push, and request re-review.
  A new head SHA needs its own review; an old approval is not transferable.
- Address every finding with a fix or an explicit reasoned response for Sohan
  to decide. Never dismiss feedback silently.
- Keep commits small and descriptive. Do not publish private plans, credentials,
  collector artifacts, or real account information in screenshots or PRs.

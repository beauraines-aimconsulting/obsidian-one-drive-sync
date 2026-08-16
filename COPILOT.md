# Copilot Instructions

## Workflow
- Work one issue at a time unless I explicitly ask for parallel work.
- Create a fresh branch from `origin/main` for each issue.
- Keep PRs small and focused: one issue = one PR.
- Rebase or cherry-pick onto current `main` before opening or updating a PR so the PR only shows its own changes.
- Link the issue in the PR body with `Resolves #<issue>`.
- Update the GitHub issue task list/checklist as work progresses.
- Mark the issue as in progress when starting, and add a short status comment when useful.
- Do not add new tools, packages, or architectural layers unless I ask.

## TypeScript
- Use strict TypeScript.
- Avoid `any`, unsafe casts, and `unknown as` patterns.
- Prefer explicit interfaces/types for public APIs and shared data.
- Use ESM imports with `.js` extensions in source files.
- Keep functions small and typed; add return types when it improves clarity.
- Reuse existing helpers and patterns instead of duplicating logic.
- Prefer standard library + existing dependencies over new libraries.

## Validation
- Update or add tests for every behavior change.
- Use the existing test runner and keep tests aligned with current patterns.
- Verify with the smallest relevant build/lint/test commands before finishing.
- Do not claim completion until the code, tests, and PR linkage are all in place.

## Code Quality
- Make surgical changes; avoid unrelated refactors.
- Follow the repo’s current structure and naming.
- Handle errors explicitly; do not swallow them.
- Keep logging and console output concise and useful.
- For CLI work, preserve graceful shutdown and clear user-facing output.

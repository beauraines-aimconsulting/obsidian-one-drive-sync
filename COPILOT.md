# Copilot Instructions

## Workflow
- Work one issue at a time unless I explicitly ask for parallel work.
- Create a fresh branch from `origin/main` for each issue.
- Keep PRs small and focused: one issue = one PR.
- Before editing, verify the working tree and preserve unrelated user changes; never include unrelated files in the issue branch.
- Rebase or cherry-pick onto current `main` before opening or updating a PR so the PR only shows its own changes.
- After validation, commit the complete issue change with a clear conventional commit message and include the required Copilot co-author trailer.
- Push the issue branch and open a pull request unless I explicitly ask to stop before publication.
- Do not finish with uncommitted changes or leave the work only on a local branch: publication means commit, push, and open the PR after validation.
- If the task starts with existing uncommitted changes that belong to the issue, carry them onto the focused branch, validate them, commit them, push the branch, and open the PR.
- The PR title and body must describe the change, include validation results, and link the issue with `Resolves #<issue>`.
- Do NOT force push (`git push -f`) unless explicitly told to. Multiple commits in a PR are fine — PRs are squash-merged.
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

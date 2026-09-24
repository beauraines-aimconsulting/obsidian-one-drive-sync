# Agent Instructions

## Delivery workflow
- Start each issue on a fresh focused branch from `origin/main`; do not work directly on `main`.
- Preserve unrelated working-tree changes and include only files relevant to the issue.
- Validate the complete change with the smallest relevant build, lint, and test commands.
- After validation, commit all issue changes with a clear conventional commit message and include:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Push the issue branch to `origin` and open a pull request when the work is complete. Do not stop after editing, testing, or committing unless explicitly instructed.
- The pull request title and body must explain the change, list validation performed, and include `Resolves #<issue>` when an issue number is available.
- Never force-push unless explicitly instructed.

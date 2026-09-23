# Copilot instructions for obsidian-one-drive-sync

This repository is a TypeScript CLI for selectively publishing Obsidian notes to OneDrive through Microsoft Graph. The app watches a vault, evaluates notes against a rules engine, and optionally uploads eligible Markdown files.

## Repository context and architecture

- `src/main.ts` is the CLI entry point. It parses command-line flags, configures the app, runs dry-run/explain/sync/watch flows, and wires together the scheduler, Graph sync, and local web UI.
- `src/config/ConfigManager.ts` loads configuration from defaults, a JSON config file, and environment variables. Precedence is: defaults < `RULES_CONFIG`/JSON config < env vars. `VAULT_PATH` and `OUTPUT_PATH` are required unless set correctly in config/env.
- `src/vault/` contains the file-watcher path: `VaultWatcher` listens for vault changes and `walkMarkdown.ts` scans a vault for Markdown files.
- `src/publications/PublicationService.ts` is the main evaluation layer. It parses frontmatter and inline tags, combines them, hashes content for caching, and evaluates file eligibility via the rule engine.
- `src/rules/` holds the rule system. `RuleEngine` evaluates named rules with `AND` or `OR` composition, and `RuleLoader` supports both v1 and v2 config shapes. Rules are defined under `rules.definitions` and composed via `rules.match` in the v2 format.
- `src/graph/` handles Microsoft Graph auth and OneDrive sync. `GraphAuthProvider` and `SyncService` are the main abstraction points for authentication and upload decisions.
- `src/schedule/` and `src/web/` provide periodic sync scheduling and the optional local admin UI.

## Commands

Install dependencies:

```bash
npm install
```

Build the CLI:

```bash
npm run build
```

Run the app directly in development mode:

```bash
npm run dev -- --dry-run
npm run dev -- --watch --sync
```

Run the lint and format checks:

```bash
npm run lint
npm run format:check
```

Run the unit test suite:

```bash
npm test
```

Run a single test file or a single test name:

```bash
npx vitest run tests/publications/PublicationService.test.ts
npx vitest run tests/rules/RuleEngine.test.ts -t "AND composition"
```

Run the integration suite:

```bash
npm run test:integration
```

Run the optional E2E/browser suite:

```bash
npm run test:e2e
```

For browser-based E2E investigation, use the **Playwright MCP server** when available. Build
the application first, then use the repository's `playwright.config.ts` and existing
`tests/e2e/` specs as the source of truth for the target URL, browser behavior, and fixtures.
Prefer Playwright MCP for reproducing UI flows, inspecting browser console/network failures,
and validating the local web UI; use the Playwright test runner for repeatable regression
coverage.

For repository and CI context, use the **GitHub MCP server** when available to inspect related
issues, pull requests, workflow runs, and repository files. Keep GitHub lookups scoped to this
repository and use them to confirm existing E2E expectations before changing tests or workflows.

Typical targeted E2E commands:

```bash
npx playwright test tests/e2e/<spec>.spec.ts
npx playwright test tests/e2e/<spec>.spec.ts -g "test name"
```

## Working conventions specific to this repo

- The project is ESM-based; source imports use `.js` extensions even though the files are TypeScript.
- Node 22+ is required (`"engines": { "node": ">=22" }`).
- TypeScript is used with strict typing. Avoid `any`, unsafe assertions, and duplicated logic when a shared helper exists.
- Reuse the repo’s CLI patterns: use `--dry-run`, `--explain`, `--explain-json`, and `--config` before performing upload-heavy or mutating actions.
- Configuration conventions are important:
  - `RULES_CONFIG` points to a JSON file that contains a top-level `config` object.
  - `config.example.json` and `config.json` are the practical references for expected config keys.
  - The default rule config path is `./config/rules.json`.
- Rules are versioned. Prefer the v2 document shape (`rulesVersion: 2`, `rules.definitions`, `rules.match`) when adding or changing rules.
- `--migrate-rules` is the repo-supported migration path from legacy v1 rules docs into the v2 form.
- Tests live under `tests/**/*.test.ts`; the Vitest config excludes `tests/e2e/**` from the default suite.
- This repo includes a local admin web UI and health endpoint; if a change touches the sync lifecycle, keep graceful shutdown behavior and clear console output intact.

## Existing guidance to preserve

- `COPILOT.md` already states the repo’s workflow expectations: work one issue at a time, keep PRs focused, keep code surgical, and verify with the smallest relevant build/test/lint command before finishing.
- Follow the repo’s current TypeScript and validation patterns from that file as a companion to these instructions.

## Typical workflow for future sessions

- Start by checking the current CLI mode (`--dry-run`, `--watch`, `--sync`, `--explain`) and the config path.
- Prefer small, targeted fixes in the parsing/evaluation/sync path rather than broad refactors.
- When changing rules or config behavior, validate the config shape and the rule engine output before touching Graph sync behavior.
- When changing file-watching or sync logic, verify both the rule evaluation path and the final upload path with the smallest relevant tests.

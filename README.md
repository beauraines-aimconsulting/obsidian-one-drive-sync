# Obsidian OneDrive Sync

Selective publication pipeline for Obsidian vault content.  
Phase 1 focuses on watching a vault, evaluating notes against a rule engine, and reporting
whether each Markdown file is eligible for publication.

## Overview / motivation

Obsidian vaults often contain a mix of private, draft, and publishable notes. This project
creates a small, typed CLI that:

- watches a vault for Markdown changes
- parses YAML frontmatter and inline tags
- evaluates notes with a rule system
- prints a simple eligibility decision to the console

## Features

- TypeScript + ESM CLI
- chokidar-based vault monitoring
- YAML frontmatter parsing
- inline Obsidian tag extraction
- file filtering for `.md` notes
- rule engine with `AND` / `OR` composition
- structured logging
- dry-run scan mode

## Architecture

```text
┌────────────────────┐
│   Obsidian Vault   │
└─────────┬──────────┘
          │ file events
          v
┌────────────────────┐
│    VaultWatcher    │
└─────────┬──────────┘
          │ filtered events
          v
┌────────────────────┐      ┌────────────────────┐
│  VaultService      │-----> │ FrontmatterParser  │
└─────────┬──────────┘      └────────────────────┘
          │
          v
┌────────────────────┐      ┌────────────────────┐
│ PublicationService │-----> │ InlineTagParser    │
└─────────┬──────────┘      └────────────────────┘
          │
          v
┌────────────────────┐
│    RuleEngine      │
└─────────┬──────────┘
          │
          v
┌────────────────────┐
│ Rule implementations│
│ Frontmatter/Path/  │
│ Category/Tag/Priv. │
└────────────────────┘
```

## Quick start

### 1) Install

```bash
npm install
```

### 2) Configure

Create a `.env` file in the repository root:

```dotenv
VAULT_PATH=/Users/you/Obsidian/Vault
OUTPUT_PATH=./output
LOG_LEVEL=info
DEBOUNCE_DELAY=300
IGNORE_PATTERNS=.git/**,.obsidian/**,node_modules/**
RULES_CONFIG=./config/rules.json
```

Or create a JSON config file and point `RULES_CONFIG` at it:

```json
{
  "config": {
    "vaultPath": "/Users/you/Obsidian/Vault",
    "outputPath": "./output",
    "logLevel": "info",
    "debounceDelay": 300,
    "ignorePatterns": [".git/**", ".obsidian/**", "node_modules/**"]
  }
}
```

### 3) Run

Dry run:

```bash
npm run dev -- --dry-run
```

Watch mode:

```bash
npm run dev
```

Built CLI:

```bash
npm run build
npm start
```

## Configuration reference

Configuration is loaded in this order:

1. defaults
2. JSON config file referenced by `RULES_CONFIG`
3. environment variables

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `VAULT_PATH` | yes | Absolute path to the Obsidian vault |
| `OUTPUT_PATH` | yes | Output directory path |
| `RULES_CONFIG` | no | Path to the JSON config file |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, or `error` |
| `DEBOUNCE_DELAY` | no | File change debounce in milliseconds |
| `IGNORE_PATTERNS` | no | Comma-separated glob patterns |

### Defaults

- `logLevel`: `info`
- `debounceDelay`: `300`
- `rulesConfig`: `./config/rules.json`
- `ignorePatterns`: `.git/**`, `.obsidian/**`, `node_modules/**`, `.DS_Store`

### Notes

- `OUTPUT_PATH` is currently required by the config loader, even though Phase 1 only reports
  eligibility to the console.
- `--config <path>` sets `RULES_CONFIG` for the current run.
- The JSON config file is expected to contain a top-level `config` object.

## Rule system

The rule engine is code-first. Rules are implemented in `src/rules/implementations/` and
combined by `RuleEngine`.

You can wire rules directly in code:

```ts
import { PublicationService } from './src/publications/PublicationService.js';
import { FrontmatterRule } from './src/rules/implementations/FrontmatterRule.js';
import { PrivacyRule } from './src/rules/implementations/PrivacyRule.js';
import { PathRule } from './src/rules/implementations/PathRule.js';

const service = new PublicationService();

service.addRule('frontmatter', new FrontmatterRule());
service.addRule('privacy', new PrivacyRule());
service.addRule(
  'path',
  new PathRule({ include: ['work/**'], exclude: ['work/drafts/**'] })
);
```

### Built-in rules

- `FrontmatterRule`: passes when `publish: true`
- `PrivacyRule`: fails when `private: true` unless allowed
- `CategoryRule`: whitelist/blacklist by `category`
- `TagRule`: whitelist/blacklist by `tags`
- `PathRule`: include/exclude by glob path

### Frontmatter example

```md
---
publish: true
private: false
category: work
tags:
  - copilot
  - publishing
---

Ready to publish.
```

### Path rule example

```ts
new PathRule({
  include: ['work/**', 'projects/**'],
  exclude: ['work/drafts/**'],
});
```

### Tag rule example

```ts
new TagRule({
  whitelist: ['copilot', 'important'],
  requireAny: true,
});
```

### Composition

- `AND` (default): all configured rules must pass
- `OR`: any configured rule may pass

## Graph API Setup (Phase 2 prep)

The `--probe` command tests Microsoft Graph API connectivity for future OneDrive sync.

### Quick test (no app registration)

```bash
npm run build
node dist/main.js --probe
```

This uses the Azure CLI's well-known client ID. It validates authentication but may not
have `Files.ReadWrite` permission.

### Full setup with app registration

Register an app in your Azure AD tenant:

```bash
# Register the app (replace tenant if needed)
az ad app create \
  --display-name "Obsidian OneDrive Sync" \
  --public-client-redirect-uris "http://localhost" \
  --sign-in-audience "AzureADMyOrg" \
  --query '{clientId:appId, objectId:id}' \
  -o json

# Enable public client flows (required for device-code auth)
az ad app update --id <CLIENT_ID> --is-fallback-public-client true
```

Add required API permissions:

```bash
# User.Read (e1fe6dd8...) + Files.ReadWrite (5c28f0bf...)
az ad app permission add \
  --id <CLIENT_ID> \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    e1fe6dd8-ba31-4d61-89e7-88639da4683d=Scope \
    5c28f0bf-8a70-41f0-8446-d4ab1b98c7e0=Scope
```

Grant admin consent (requires Azure AD admin):

```bash
az ad app permission admin-consent --id <CLIENT_ID>
```

### Configure credentials

Set environment variables:

```bash
export GRAPH_CLIENT_ID=<your-app-client-id>
export GRAPH_TENANT_ID=<your-tenant-id>
```

Or add to your `config.json`:

```json
{
  "config": {
    "clientId": "<your-app-client-id>",
    "tenantId": "<your-tenant-id>"
  }
}
```

### Run the probe

```bash
node dist/main.js --probe
# or with config:
node dist/main.js --config ./config.json --probe
```

The probe tests:
1. **Authentication** — device-code flow (sign in via browser)
2. **User.Read** — basic profile access
3. **Files.ReadWrite** — OneDrive read access
4. **Files.ReadWrite (write)** — uploads and deletes a small test file

If permissions are blocked, it generates a formatted admin consent request to send to IT.

## CLI usage

```text
Usage: obsidian-one-drive-sync [options]

Options:
  --config <path>  Path to config.json
  --dry-run        Scan once and exit
  --probe          Test Graph API connectivity and permissions
  --help           Show help
```

Examples:

```bash
npm run dev -- --help
npm run dev -- --config ./config/rules.json --dry-run
npm start -- --dry-run
```

### What the CLI does

- loads configuration
- validates `VAULT_PATH`
- scans Markdown files in dry-run mode
- or watches the vault and evaluates add/change events continuously
- prints one line per file with an eligible / not-eligible result

## Development guide

### Scripts

- `npm run build` — compile TypeScript to `dist/`
- `npm run dev` — run the CLI with `ts-node`
- `npm test` — run Vitest
- `npm run lint` — run ESLint
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — format source files
- `npm run format:check` — check formatting

### Working on the codebase

- keep changes focused to one issue
- prefer strict TypeScript and small, typed functions
- update tests when behavior changes
- verify with the smallest relevant build/test command

## Troubleshooting

- **`VAULT_PATH is required`**: set `VAULT_PATH` in `.env` or your shell.
- **`OUTPUT_PATH is required`**: set `OUTPUT_PATH` even if you only want console output.
- **Nothing happens in watch mode**: make sure the vault path exists and contains `.md` files.
- **Files are ignored unexpectedly**: check `IGNORE_PATTERNS` and the default `.git/**`,
  `.obsidian/**`, and `node_modules/**` exclusions.
- **Config file not applied**: confirm `RULES_CONFIG` points to a JSON file with a top-level
  `config` object.

## Roadmap

Phase 1 is focused on vault monitoring and eligibility decisions. Planned later work includes:

- OneDrive publication/sync
- Microsoft Graph authentication
- git-backed versioning
- richer rule management
- optional UI for rule administration

## Contributing

1. Create a feature branch from `main`
2. Keep the branch focused on one issue
3. Use conventional commits
4. Run tests and lint before opening a PR
5. Include `Resolves #<issue>` in the PR body

## License

MIT

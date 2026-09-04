# Obsidian OneDrive Sync

Selective publication pipeline for Obsidian vault content.  
It watches a vault, evaluates notes against a rule engine, and syncs the eligible Markdown
files to OneDrive through the Microsoft Graph API. It runs locally or as a container.

## Overview / motivation

Obsidian vaults often contain a mix of private, draft, and publishable notes. This project
creates a small, typed CLI that:

- watches a vault for Markdown changes
- parses YAML frontmatter and inline tags
- evaluates notes with a rule system
- prints a simple eligibility decision to the console
- uploads eligible notes to a OneDrive folder on demand

## Features

- TypeScript + ESM CLI
- chokidar-based vault monitoring
- YAML frontmatter parsing
- inline Obsidian tag extraction
- file filtering for `.md` notes
- rule engine with `AND` / `OR` composition
- structured logging
- dry-run scan mode
- Microsoft Graph device-code auth with a persistent token cache
- OneDrive upload with change detection, so unchanged notes are skipped
- container image with a health endpoint and graceful shutdown

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
ONEDRIVE_FOLDER=ObsidianPublished
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
    "oneDriveFolder": "ObsidianPublished",
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
| `ONEDRIVE_FOLDER` | no | Destination folder in OneDrive; defaults to `ObsidianPublished` |
| `RULES_CONFIG` | no | Path to the JSON config file |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, or `error` |
| `DEBOUNCE_DELAY` | no | File change debounce in milliseconds |
| `IGNORE_PATTERNS` | no | Comma-separated glob patterns |
| `HEALTH_PORT` | no | Port for the health endpoint in watch mode; defaults to `8080` |
| `WATCH_USE_POLLING` | no | Set to `true` to poll for changes instead of using native filesystem events. Required for bind-mounted vaults in Docker on macOS/Windows |
| `WATCH_POLL_INTERVAL` | no | Poll interval in milliseconds when polling is enabled; defaults to `1000` |

### Defaults

- `logLevel`: `info`
- `debounceDelay`: `300`
- `rulesConfig`: `./config/rules.json`
- `oneDriveFolder`: `ObsidianPublished`
- `healthPort`: `8080`
- `usePolling`: `false`
- `pollInterval`: `1000`
- `ignorePatterns`: `.git/**`, `.obsidian/**`, `.trash/**`, `node_modules/**`, `Templates/**`,
  `.DS_Store`, `*.bookmark.md`, `**/*.bookmark.md`

> Setting `IGNORE_PATTERNS` or `ignorePatterns` **replaces** this list rather than adding to it —
> re-include the defaults you still want. Both `*.bookmark.md` and `**/*.bookmark.md` are needed:
> the first matches vault-root files, the second matches files in subfolders.

### Notes

- `OUTPUT_PATH` is currently required by the config loader, even though the CLI reports
  eligibility to the console and uploads directly to OneDrive rather than writing locally.
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

### Frontmatter value types

Frontmatter is parsed with the YAML **core schema** rather than js-yaml's default
schema. The default schema implements YAML 1.1 timestamps and silently turns
`created: 2026-08-16` into a JavaScript `Date`, which makes string comparisons in
rules behave unexpectedly.

With the core schema, date-like fields keep the exact string the author wrote:

```md
---
created: 2026-08-16          # -> '2026-08-16'   (string)
updated: 2026-08-16 10:30:00 # -> '2026-08-16 10:30:00' (string)
---
```

Booleans, numbers, and `null`/`~` still resolve normally. Rules that compare date
fields can therefore treat them as plain strings.

### Malformed frontmatter

If a note's frontmatter block is present but fails to parse, the file is
**skipped and reported distinctly** from a note that was evaluated and simply
failed a rule:

```
⚠️ notes/broken.md - Frontmatter parse error at line 2, column 19: bad indentation of a mapping entry
```

Behaviour on a parse failure:

- A concise warning is logged through the standard logger (so it respects
  `LOG_LEVEL`), naming the vault-relative file, line, column, and reason. No
  stack traces or note contents are written to the log.
- Rule evaluation is short-circuited and the file is **never published**. Because
  `publish`/`private`/`tags` could not be read, publishing it would risk leaking a
  note that was meant to stay private.
- If the note was already published, the existing OneDrive copy is **left in
  place**. A parse error means "publish intent unknown", not "unpublish", so a
  transient YAML typo saved mid-edit will not delete an already-published note.
- `--sync` reports these in a separate `⚠️ Skipped (frontmatter parse errors)`
  summary line, so they are not confused with upload failures.

A common cause is an Obsidian template placeholder that was never rendered.
Unquoted `{{` starts a YAML flow mapping, so quote the value:

```md
---
created: "{{date}} {{time}}:00"   # quoted — parses fine
---
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

## Graph API Setup

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
  --dry-run        Scan once and exit (or preview sync without uploading)
  --sync           Sync eligible files to OneDrive
  --watch          Keep running and sync changes as they happen
                   (combine with --sync for an initial full sync)
  --force-sync     Re-upload all eligible files regardless of changes
  --probe          Test Graph API connectivity and permissions
  --logout         Clear cached authentication tokens
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

## Health endpoint

In watch mode the CLI serves a health endpoint for container orchestrators:

```bash
curl http://localhost:8080/healthz
```

```json
{
  "status": "ok",
  "watcherActive": true,
  "lastFileProcessedAt": "2026-09-01T18:00:00.000Z"
}
```

- Returns `200` while the vault watcher is active
- Returns `503` if the watcher is not active, so an orchestrator can restart the container
- Returns `404` for any other path
- Only runs in watch mode — `--dry-run`, one-shot `--sync`, and `--probe` exit instead of serving

### Changing the port

The endpoint listens on `8080` by default. If that port is already in use, override it with
`HEALTH_PORT`:

```bash
HEALTH_PORT=8081 npm start
```

For Docker, publish the port you want on the host:

```bash
docker run -e HEALTH_PORT=8081 -p 8081:8081 obsidian-one-drive-sync
```

With Compose, set `HEALTH_PORT` in your `.env` file. It changes the **host** port only; the
container keeps listening on `8080`, so `HEALTH_PORT=8081` makes the endpoint available at
`http://localhost:8081/healthz`.

## Docker deployment

The image is a multi-stage build: TypeScript is compiled in a build stage, and the runtime
stage is a slim Node image containing only `dist/` and production dependencies. It runs as the
non-root `node` user and logs to stdout/stderr for container log aggregation.

### Build the image

```bash
docker build -t obsidian-one-drive-sync:local .
```

### Volume mounts

| Container path | Required | Mode | Purpose |
| --- | --- | --- | --- |
| `/vault` | yes | read-only | The Obsidian vault to monitor |
| `/config/rules.json` | recommended | read-only | Rules config file; without it every file passes |
| `/home/node/.obsidian-sync` | yes for sync | read-write | MSAL token cache and sync state; must be a named volume so tokens and upload state survive restarts |
| `/output` | no | read-write | Output directory; reserved, not written to yet |

The vault is mounted read-only on purpose — the tool never modifies your notes.

### Environment variables

Image defaults already point the path variables at the mount points above, so you normally only
set credentials and behavior:

| Variable | Required | Default in image | Description |
| --- | --- | --- | --- |
| `GRAPH_CLIENT_ID` | for sync/probe | unset | Entra app registration client ID |
| `GRAPH_TENANT_ID` | no | `common` | Tenant ID, or `common` for multi-tenant |
| `ONEDRIVE_FOLDER` | no | `ObsidianPublished` | Destination folder in OneDrive |
| `VAULT_PATH` | no | `/vault` | Override only if you mount elsewhere |
| `OUTPUT_PATH` | no | `/output` | Override only if you mount elsewhere |
| `RULES_CONFIG` | no | `/config/rules.json` | Override only if you mount elsewhere |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |
| `DEBOUNCE_DELAY` | no | `300` | File change debounce in milliseconds |
| `WATCH_USE_POLLING` | for watch mode on macOS/Windows | `false` | Poll instead of relying on native filesystem events |
| `WATCH_POLL_INTERVAL` | no | `1000` | Poll interval in milliseconds |
| `HEALTH_PORT` | no | `8080` | Health endpoint port inside the container |

### Watch mode on bind-mounted vaults

Filesystem events do not propagate into the container for bind mounts on Docker Desktop for
macOS and Windows, so watch mode sees the initial vault but never reacts to edits. Set
`WATCH_USE_POLLING=true` there — it is already the default in `compose.yaml`:

```bash
docker run -e WATCH_USE_POLLING=true ... obsidian-one-drive-sync:local
```

On Linux hosts, native events work and polling can stay off, which is cheaper for large vaults.
If you enable polling on a large vault and see high CPU, raise `WATCH_POLL_INTERVAL`.

### Example `docker run`

Watch mode, evaluating eligibility and serving the health endpoint:

```bash
docker run --rm --init \
  -v "/absolute/path/to/vault:/vault:ro" \
  -v "/absolute/path/to/config.json:/config/rules.json:ro" \
  -v obsidian-sync-state:/home/node/.obsidian-sync \
  -e GRAPH_CLIENT_ID=your-app-client-id \
  -e GRAPH_TENANT_ID=your-tenant-id \
  -p 8080:8080 \
  obsidian-one-drive-sync:local
```

A one-shot dry run, which scans and exits without contacting OneDrive:

```bash
docker run --rm \
  -v "/absolute/path/to/vault:/vault:ro" \
  -v "/absolute/path/to/config.json:/config/rules.json:ro" \
  obsidian-one-drive-sync:local node dist/main.js --dry-run
```

### Example Compose usage

`compose.yaml` is checked in for local development. Copy the example env file and fill it in:

```bash
cp .env.compose.example .env
```

`.env` must set `HOST_VAULT_PATH`, `HOST_RULES_CONFIG_PATH`, and `GRAPH_CLIENT_ID`; Compose
fails fast if any of them are missing. Then:

```bash
docker compose up --build
curl http://localhost:8080/healthz
docker compose down
```

Compose declares the `sync-state` named volume for you, so the token cache and sync state
persist across `up`/`down` cycles.

#### Vaults with symlinked folders

If top-level folders in your vault are symlinks that point outside the vault (for example
`MSFT -> ../.nb/MSFT`), mounting only the vault directory leaves those links dangling inside
the container, and notes under them are never watched or evaluated. Mount a parent directory
that contains both the vault and the link targets:

```bash
HOST_MOUNT_PATH=/Users/you/LocalDocs
CONTAINER_MOUNT_PATH=/vaultroot
CONTAINER_VAULT_PATH=/vaultroot/Notes
```

Relative link targets then resolve inside the container, and vault-relative paths used by the
rules (`MSFT/**`) still match.

### First-run authentication

Authentication uses the device-code flow, which is interactive: it prints a URL and a code that
you have to enter in a browser. Seed the token cache once with an attached run before you run
the container detached:

```bash
docker compose run --rm obsidian-sync node dist/main.js --probe
```

Because the token cache lives in the `sync-state` volume, later runs reuse it without prompting.

### Running a sync in the container

The default command is `--sync --watch`: it performs a full sync, then stays running and uploads
each change as it happens. Start it in the background with:

```bash
docker compose up -d
docker compose logs -f
```

To run a one-shot sync that exits when finished, omit `--watch`:

```bash
docker compose run --rm obsidian-sync node dist/main.js --sync
```

Add `--dry-run` to preview the plan, or `--force-sync` to re-upload everything. Passing `--watch`
without `--sync` gives the old evaluate-only behaviour (logs eligibility, uploads nothing).

> The first run in watch mode still needs an interactive device-code login. Do that once with
> `docker compose run --rm obsidian-sync node dist/main.js --probe`; the cached token in the
> `sync-state` volume lets `docker compose up -d` start unattended afterwards.

### Graceful shutdown

The container handles `SIGTERM`, stops the watcher, and drains in-flight evaluations before
exiting, so `docker stop` and orchestrator rollouts do not cut work off mid-evaluation. Run with
`--init` (Compose sets `init: true` already) so signals reach the Node process correctly.

### Container troubleshooting

- **`EACCES` writing sync state**: `/home/node/.obsidian-sync` must be writable by the `node`
  user. Use a named volume rather than a host bind mount, which is likely to be root-owned.
- **Nothing is detected in watch mode**: on macOS and Windows, bind mounts do not deliver
  filesystem events into the container — set `WATCH_USE_POLLING=true`. Otherwise confirm the
  vault bind mount resolves to a real host directory containing `.md` files;
  `docker compose run --rm obsidian-sync ls /vault` is a quick check. On macOS, a mount under
  `/tmp` can silently appear empty because Docker Desktop does not share it by default — use a
  path under your home directory, or add the path under Docker Desktop's
  **Settings → Resources → File sharing**.
- **`VAULT_PATH is required` or an invalid vault path**: you overrode a path variable without a
  matching mount. Leave the path variables at their image defaults unless you also change the
  mounts.
- **Config file not applied**: the rules file must be mounted at `/config/rules.json` and
  contain a top-level `config` object. `HOST_RULES_CONFIG_PATH` must point at the file itself,
  not its parent directory.
- **Health port already in use**: set `HEALTH_PORT` in `.env` to change the published host port;
  the container keeps listening on `8080`.
- **Re-prompted for a device code every run**: the `sync-state` volume is missing, so the token
  cache is discarded with the container. Clear tokens deliberately with `node dist/main.js
  --logout`.

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
- **A note is skipped with `Frontmatter parse error`**: its YAML frontmatter is invalid, so
  the file is excluded from sync. The warning names the file, line, and column. Unrendered
  Obsidian template placeholders are a common cause — quote them (`created: "{{date}}"`).

## Roadmap

Vault monitoring, eligibility rules, OneDrive sync, and containerization are implemented.
Planned later work includes:

- scheduled syncs without an external scheduler
- richer rule management and advanced filtering
- optional UI for rule administration

Git-backed versioning of published content was considered and has been dropped from the
roadmap.

## Contributing

1. Create a feature branch from `main`
2. Keep the branch focused on one issue
3. Use conventional commits
4. Run tests and lint before opening a PR
5. Include `Resolves #<issue>` in the PR body

## License

MIT

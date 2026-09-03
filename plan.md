# Obsidian Copilot Knowledge Publisher - Implementation Plan

## Phase 1: Vault Monitoring + Publication Eligibility Engine

**Overall Approach:**
- Scaffold a modern Node.js/TypeScript project with proper build, test, and lint tooling
- Implement file system monitoring using chokidar for detecting changes in an Obsidian vault
- Build a rules-based publication eligibility engine that evaluates frontmatter and file metadata
- Create a clean, testable architecture with separation of concerns

---

## Phase 1A: Project Scaffolding

### Setup and Configuration
1. Initialize npm project with package.json (name: obsidian-copilot-sync, type: module for ESM)
2. Create TypeScript configuration (tsconfig.json) with strict mode enabled
3. Set up directory structure: src/, dist/, tests/, config/
4. Add build, lint, and test scripts
5. Create .gitignore, .env.example for configuration
6. Set up ESLint and Prettier for code quality

**Dependencies to include:**
- chokidar (file watching)
- ts-node (TypeScript runtime for dev)
- typescript (language)
- vitest (testing framework)
- eslint, prettier (linting/formatting)
- dotenv (environment configuration)

**Key Files:**
- package.json
- tsconfig.json
- .eslintrc.json
- .prettierrc.json
- src/main.ts (entry point, will be placeholder for now)

---

## Phase 1B: Vault Monitoring System

### Vault Watcher
1. Create VaultWatcher class that monitors a configurable vault directory
2. Use chokidar to watch for file changes (add, modify, delete, unlink, rename)
3. Implement debouncing (300-500ms) to batch rapid file changes
4. Emit standardized change events (type, path, timestamp)
5. Handle edge cases: symlinks, ignored files, large file writes

**Key Files:**
- src/vault/VaultWatcher.ts
- src/vault/types.ts (FileChangeEvent interface)

### File Filter
1. Create FileFilter to exclude non-markdown files by default
2. Implement ignore patterns (node_modules, .git, .obsidian, etc.)
3. Support optional user-defined ignore list via config

**Key Files:**
- src/vault/FileFilter.ts
- src/config/ignorePatterns.ts

### Vault Service
1. Create VaultService as main orchestrator
2. Integrate VaultWatcher and FileFilter
3. Expose methods: startMonitoring(), stopMonitoring(), getVaultState()
4. Cache current vault file list for change detection

**Key Files:**
- src/vault/VaultService.ts

---

## Phase 1C: Publication Eligibility Engine

### Rules Engine Foundation
1. Create abstract Rule interface for publication rules
2. Implement RuleEngine that evaluates a set of rules against a file
3. Support rule composition (AND/OR logic)
4. Return evaluation result with reason/metadata

**Key Files:**
- src/rules/Rule.ts (interface)
- src/rules/RuleEngine.ts

### Rule Implementations
1. **FrontmatterRule**: Check for publish: true in file frontmatter
2. **CategoryRule**: Whitelist/blacklist by category (from frontmatter or folder structure)
3. **PathRule**: Include/exclude by file path patterns (glob-based)
4. **PrivacyRule**: Strip/exclude files marked as private
5. **TagRule**: Include/exclude by tags in frontmatter

**Key Files:**
- src/rules/implementations/FrontmatterRule.ts
- src/rules/implementations/CategoryRule.ts
- src/rules/implementations/PathRule.ts
- src/rules/implementations/PrivacyRule.ts
- src/rules/implementations/TagRule.ts

### Frontmatter Parser
1. Create FrontmatterParser to extract YAML frontmatter from markdown
2. Handle missing frontmatter gracefully
3. Cache parsed metadata

**Key Files:**
- src/parser/FrontmatterParser.ts
- src/parser/types.ts

### Inline Tag Parser
1. Create InlineTagParser to extract Obsidian inline tags from markdown content
2. Support tags like `#Work` and `#ms-rte` even when no frontmatter exists
3. Ignore markdown link anchors and wikilink bookmarks such as `[[File#bookmark]]`
4. Ignore code blocks and inline code

**Key Files:**
- src/parser/InlineTagParser.ts

### Publication Eligibility Service
1. Create PublicationService that orchestrates the eligibility check
2. Accept file path and content
3. Load applicable rules from config
4. Return publish decision with reasoning

**Key Files:**
- src/publications/PublicationService.ts

---

## Phase 1D: Configuration System

### Config Manager
1. Load configuration from .env file (vault path, output path, rules, etc.)
2. Support config file (config.json or config.ts)
3. Validate required settings
4. Provide sensible defaults
5. Accept injected `cwd`, `env`, and `loadDotenv` options so config loading can be pointed at
   an explicit directory and environment source rather than the ambient process (#77)

**Key Files:**
- src/config/ConfigManager.ts
- .env.example
- config.example.json

**Configuration Options:**
```
VAULT_PATH=/path/to/obsidian/vault
OUTPUT_PATH=/path/to/output/directory
RULES_CONFIG=config.json
LOG_LEVEL=info
DEBOUNCE_DELAY=300
```

---

## Phase 1E: Logging and Utilities

### Logger
1. Create simple logger with info, warn, error levels
2. Support file and console output
3. Include timestamps and context

**Key Files:**
- src/utils/Logger.ts

### Event Emitter
1. Create lightweight EventEmitter for pub/sub pattern
2. Use for VaultWatcher events and eligibility results

**Key Files:**
- src/utils/EventEmitter.ts

---

## Phase 1F: Testing

### Unit Tests
1. VaultWatcher (mock fs operations)
2. FileFilter (test ignore patterns)
3. RuleEngine (test rule evaluation)
4. FrontmatterParser (test YAML extraction)
5. PublicationService (test eligibility decisions)

### Integration Tests
1. End-to-end: file change → eligibility evaluation

**Key Files:**
- tests/vault/VaultWatcher.test.ts
- tests/rules/RuleEngine.test.ts
- tests/parser/FrontmatterParser.test.ts
- tests/publications/PublicationService.test.ts

---

## Phase 1G: Main Entry Point

### CLI Interface (Minimal)
1. Create main.ts that:
   - Loads config
   - Initializes VaultService
   - Initializes PublicationService
   - Starts monitoring
   - Logs results to console
   - Listens for changes and evaluates eligibility

**Key Files:**
- src/main.ts

---

## Implementation Order (Dependency Chain)

1. **Project Scaffolding** (1A) - Foundation, can proceed in parallel
2. **Config System** (1D) - Needed by other modules
3. **Utilities** (1E) - Logger, EventEmitter (lightweight, no deps)
4. **Frontmatter Parser** (1C - parser) - Standalone, no external deps
5. **File Filter** (1B - filter) - Standalone
6. **Rule Implementations** (1C - rules) - Depends on FrontmatterParser
7. **Rule Engine** (1C - engine) - Depends on Rule interface
8. **Vault Watcher + Service** (1B) - Depends on FileFilter
9. **Publication Service** (1C - service) - Depends on RuleEngine, FrontmatterParser
10. **Main Entry Point** (1G) - Depends on all above
11. **Tests** (1F) - After implementations

---

## Key Decisions for Phase 1

- **Language**: TypeScript (strict mode) - strong typing aids eligibility rules
- **File Watching**: chokidar with 300-500ms debounce
- **Frontmatter Format**: YAML (standard Obsidian)
- **Rule Format**: Code-based (TS classes) for type safety
- **Extensibility**: Rule interface allows custom implementations
- **Testing**: vitest for speed and ESM support
- **OneDrive/Auth**: implemented in Phase 2

---

## Acceptance Criteria for Phase 1

- [x] Project builds without errors (npm run build)
- [x] All tests pass (npm run test)
- [x] Code passes linting (npm run lint)
- [x] VaultWatcher detects file changes accurately
- [x] PublicationService correctly evaluates eligibility based on rules
- [x] Config system loads from .env or config.json
- [x] CLI runs and logs eligibility decisions to console
- [x] README documents how to configure and run

## Current Status

**Phase 1 — complete.** Project scaffolding, configuration system, logging & utilities,
frontmatter parser, inline tag parser, file filter, publication rules, rule engine, vault
watcher, vault service, publication service, CLI entry point, unit tests, integration tests,
and documentation are all merged. The suite runs 414 tests across 24 files; build, tests, and
lint are green.

**Phase 2 (OneDrive sync + Graph auth) — complete, with git versioning dropped.** Merged work
covers MSAL device-code authentication, persistent token cache, the Graph connectivity probe
with admin-consent request generation, the OneDrive upload client, sync state tracking for
change detection, the sync service, and the CLI `--sync`, `--force-sync`, `--dry-run`,
`--probe`, and `--logout` modes.

**Phase 3 (containerization) — complete.** Multi-stage Dockerfile running as non-root, local
Docker Compose setup, health endpoint, graceful SIGTERM shutdown with in-flight evaluation
draining, CI workflows for build/test and container image, and container documentation. The
sync-state volume permission issue (#73) was fixed in #75 and is closed.

**Configuration test isolation (#77) — complete.** `ConfigManager` now accepts injected
`cwd`, `env`, and `loadDotenv` options, so config loading no longer implicitly reads the
developer's real `.env` from `process.cwd()`. Tests run against a temp sandbox and an isolated
env object, which removed four environment-dependent local test failures (#78).

**Remaining work, in suggested order:**

1. **#63 — Frontmatter parse error handling** (bug). YAMLException dumps are unhelpful, the
   offending filename is missing, and affected notes are silently excluded from sync. Highest
   user impact of the open items.
2. **#66 — CI: bump GitHub Actions to latest majors.** Clears Node 20 deprecation warnings;
   mechanical and low risk.
3. **#76 — Make note exclusions configurable** instead of hardcoded in `DEFAULT_CONFIG`.
   Simpler now that `ConfigManager` takes explicit options.
4. **Phase 4 epic (#25):**
   - **#27 Scheduled syncs** — smallest of the three and a natural follow-on to `--watch`.
   - **#28 Advanced filtering and rule options** — builds on the existing rules engine.
   - **#26 Web UI for managing rules** — largest; best deferred until the above settle.

**Current repository state:** `main` is up to date with merged PRs through #78.

### Scope change: git versioning dropped

Phase 2 originally included git version control of published content. That has been removed
from the roadmap — OneDrive itself provides file versioning, and a second version-control
system adds state to manage without a matching benefit. No git integration code exists in
`src/`, and none is planned.

---

## GitHub Workflow

**Repository Setup:**
1. Create new GitHub repository for obsidian-one-drive-sync
2. Initialize with MIT LICENSE and README
3. Set branch protection: require PR review before merge

**Issue Management:**
1. Create Phase 1 Epic issue for overall tracking
2. Create individual issues for each component:
   - Project Scaffolding
   - Configuration System
   - Logging & Utilities
   - Frontmatter Parser
   - File Filter
   - Publication Rules
   - Rule Engine
   - Vault Watcher
   - Vault Service
   - Publication Service
   - CLI Entry Point
   - Unit Tests
   - Integration Tests
   - Documentation

**Development Workflow (for each issue):**
1. Create feature branch: `feature/component-name` or `feature/gh-#issue-number`
2. Make commits with detailed messages
3. Open Pull Request with:
   - Reference to issue (#123) and include `Resolves #123` in the PR body
   - Summary of changes
   - Testing instructions
   - Any blockers or questions
4. Request **HUMAN** review before merge
5. Merge only after review approval
6. Delete branch after merge

**Commit Conventions:**
- Use conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`
- Reference issues in commit messages
- Example: `feat: add vault watcher with chokidar (closes #5)`

---

## Notes

- Phase 2 added: OneDrive sync and Microsoft Graph authentication. Git version control was
  considered and dropped.
- Phase 3 added: containerization with a volume-mounted vault, health endpoint, and CI image
  builds.
- Phase 4 could add: web UI for managing rules, scheduled syncs, more advanced filtering
- All code should be modular to support future extensibility
- **Human review is required for all PRs** - no automatic merges

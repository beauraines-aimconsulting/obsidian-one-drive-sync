# Obsidian Copilot Knowledge Publisher

## Objective

Build a local-first Node.js application that selectively publishes content from an Obsidian vault into a Microsoft 365 Copilot-accessible knowledge repository.

The solution must preserve a single source of truth (the primary Obsidian vault) while allowing intentional publication of selected notes to a separate OneDrive-backed knowledge store that can be indexed by Microsoft Graph and used by Microsoft 365 Copilot Chat.

The design should prioritize:

- Privacy
- Local ownership of data
- Explicit publication controls
- Operational simplicity
- Extensibility

---

# Problem Statement

The Obsidian vault contains both professional and personal content.

The vault should remain local and continue serving as the authoritative knowledge source.

A subset of content should be made available to Microsoft 365 Copilot without requiring:

- A second vault
- Manual copying
- Full-vault synchronization to OneDrive
- Exposure of personal content

The system should automatically identify publishable notes and synchronize only those notes to a designated OneDrive folder.

---

# High-Level Architecture

```text
Obsidian Vault
      │
      ▼
Publication Engine
      │
      ├── Inclusion Rules
      ├── Exclusion Rules
      ├── Privacy Filters
      └── Change Detection
      │
      ▼
Published Knowledge Repository
      │
      ├── Git Version History
      └── OneDrive Sync
              │
              ▼
      Microsoft Graph
              │
              ▼
      Microsoft 365 Copilot Chat
```

---

# Technology Requirements

## Runtime

- Node.js LTS

## Language

- TypeScript preferred
- JavaScript acceptable if it materially simplifies development

## Package Manager

- npm

## Source Control

- Git

## Platform

- macOS (primary target)

---

# Core Features

## 1. Vault Monitoring

Monitor an Obsidian vault for changes.

Detect:

- File creation
- File modification
- File deletion
- File rename

Changes should trigger evaluation of publication eligibility.

The solution should use filesystem notifications rather than scheduled scanning whenever practical.

Recommended approach:

- `chokidar`
- Debounced processing
- Efficient handling of large vaults
- Incremental updates

---

## 2. Publication Eligibility Engine

Determine whether
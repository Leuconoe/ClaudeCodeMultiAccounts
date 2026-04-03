# v0-2-refactor Design

Status: draft
Date: 2026-04-02
Feature: v0-2-refactor
Selected Architecture: Option C — Pragmatic Balance

## Context Anchor

| WHY | WHO | RISK | SUCCESS | SCOPE |
|---|---|---|---|---|
| The utility has outgrown its monolithic runtime and now needs clear internal seams to keep shipping safely. | Maintainers of the repo and users who rely on switching, syncing, usage display, startup guidance, and status line integration. | Refactor can easily break stable commands, installer setup, and stored account behavior if boundaries shift too aggressively. | Runtime concerns are clearly separated, smoke tests remain green, and future features no longer require editing unrelated modules. | Extract runtime/domain concerns first, keep installer orchestration thin, preserve current public command contract. |

## 1. Overview

This design adopts **Option C — Pragmatic Balance**.

The goal is not a rewrite. The goal is to split the parts of the runtime that already behave like independent subsystems, while preserving the current external contract and keeping installer changes constrained.

### Why Option C
- It addresses the real source of complexity: the `cc-switch.cjs` god file.
- It avoids over-fragmenting a small OSS utility into too many layers.
- It keeps `install.cjs`/`uninstall.cjs` mostly intact as orchestration adapters.
- It gives us testable seams without breaking user-facing commands.

## 2. Architecture Options Considered

| Option | Summary | Pros | Cons | Decision |
|---|---|---|---|---|
| A — Minimal Changes | Keep most logic in `cc-switch.cjs`, extract only obvious helpers | Lowest immediate risk | Leaves the monolith intact; weak long-term payoff | Rejected |
| B — Clean Architecture | Split everything into store/usage/output/commands/install modules with strong abstraction | Best theoretical separation | Too much churn for a small utility; higher migration and adapter risk | Rejected |
| C — Pragmatic Balance | Extract runtime-heavy logic into focused modules while keeping installer orchestration largely intact | Best balance of maintainability and delivery risk | Still leaves some coupling in installer adapters | Selected |

## 3. Target Module Boundaries

### 3.1 Runtime modules

#### `lib/store/`
Responsibilities:
- read/write `~/.ClaudeCodeMultiAccounts.json`
- snapshot current live account into store
- switch active account into live Claude files
- remove stored accounts
- backup-before-write behavior

Candidate files:
- `lib/store/io.cjs`
- `lib/store/snapshot.cjs`
- `lib/store/switch.cjs`
- `lib/store/remove.cjs`

#### `lib/usage/`
Responsibilities:
- call usage API with Claude-compatible OAuth headers
- normalize 5H/7D usage payloads
- preserve stale cached snapshots on failure
- manage retry-after based reset caching
- expose compact usage columns and full usage block data

Candidate files:
- `lib/usage/fetch.cjs`
- `lib/usage/cache.cjs`
- `lib/usage/format.cjs`

#### `lib/output/`
Responsibilities:
- account line formatting
- usage block formatting
- user guidance text
- timestamp rendering (`synced`, `used`, `reset`)

Candidate files:
- `lib/output/accounts.cjs`
- `lib/output/usage.cjs`
- `lib/output/messages.cjs`

#### `lib/actions/`
Responsibilities:
- high-level action handlers:
  - list
  - sync
  - switch
  - remove
  - usage
- coordinate store + usage + output modules

Candidate files:
- `lib/actions/list.cjs`
- `lib/actions/sync.cjs`
- `lib/actions/switch.cjs`
- `lib/actions/remove.cjs`
- `lib/actions/usage.cjs`

### 3.2 Adapter layer

#### `cc-switch.cjs`
Future role:
- parse CLI arguments
- dispatch to `lib/actions/*`
- no domain logic beyond routing

#### `install.cjs` / `uninstall.cjs`
Future role:
- generate/install wrappers
- configure hooks and status line integration
- install/remove global Claude command markdown
- no business logic about account switching itself

#### `statusline.cjs` / `session-start.cjs`
Future role:
- lightweight adapters over output/helpers
- no direct store/usage mutations beyond presentation-safe reads

## 4. Data Model Design

### 4.1 Store contract
Primary store remains:
- `~/.ClaudeCodeMultiAccounts.json`

Account entry shape (existing contract preserved):
```json
{
  "key": "email:alpha@example.invalid",
  "metadata": { "emailAddress": "alpha@example.invalid" },
  "credentials": { "claudeAiOauth": { "accessToken": "..." } },
  "capturedAt": "2026-04-02T00:00:00.000Z",
  "lastSyncedAt": "2026-04-02T00:00:00.000Z",
  "lastUsedAt": "2026-04-02T00:00:00.000Z",
  "usageSnapshot": {
    "five_hour": { "utilization": 22, "resets_at": "..." },
    "seven_day": { "utilization": 31, "resets_at": "..." },
    "fetchedAt": "2026-04-02T00:00:00.000Z"
  }
}
```

### 4.2 Live file contract
These remain mutation targets only:
- `~/.claude.json`
- `~/.claude/.credentials.json`

They are not the primary multi-account database.

### 4.3 Tool settings contract
Settings remain in:
- `~/.claude/multi-account-switch/settings.json`

Current responsibilities:
- `showUsage`
- `rateLimitResetAt`

## 5. Command Routing Design

Supported public surfaces remain unchanged:
- `cc-switch`
- `cc-switch <index>`
- `cc-switch --remove <index>`
- `cc-switch --usage`
- `cc-sync-oauth`
- `ccs`
- `ccso`
- `/cc-switch`
- `/cc-sync-oauth`
- startup reminder
- status line prepend

Routing principle:
- All public entrypoints call one runtime adapter (`cc-switch.cjs` or `cc-sync-oauth` wrappers)
- `cc-switch.cjs` delegates to action modules
- No action-specific logic should remain duplicated in installer-generated wrappers

## 6. Usage Refresh Rules

### 6.1 Current-account-first
- `cc-switch` list flow refreshes the **current account** usage before rendering
- `cc-switch --usage` performs explicit usage fetch for the current account
- other stored accounts keep their last known `usageSnapshot`

### 6.2 Failure handling
- `401` from usage API: suppress user-facing noise in normal list flow
- `429`: preserve cached values and use retry-after based reset hints where available
- unknown or failed refresh for non-current account: keep previous `usageSnapshot`

### 6.3 Display rules
- 5H/7D compact columns belong on account rows
- detailed usage block is explicit (`--usage`) or shown only when intentionally designed
- current-account reset uses live API-derived timing when available
- non-current accounts use cached snapshot / fallback estimate

## 7. Installer Design

Installer will continue to own:
- shell wrapper installation
- startup hook setup
- status line wrapper installation
- command markdown generation in `~/.claude/commands`

But installer should stop owning business decisions such as:
- how usage is fetched
- how accounts are switched
- how stale snapshots are preserved
- how output lines are formatted

## 8. Verification Strategy

### 8.1 Required smoke tests
- store import/switch/remove using temp home
- usage refresh on current account
- stale usage snapshot retention on failed refresh
- status line prepend and restore
- startup reminder install/uninstall
- shell wrapper generation (Windows / Git Bash / WSL)
- global command markdown generation and uninstall cleanup

### 8.2 Refactor safety rule
Each extraction step must preserve:
- command output compatibility
- installer idempotency
- store file integrity
- no regression in current smoke tests

## 9. Migration / Rollout Strategy

This refactor is **internal only**.
No user-facing migration is introduced in this phase.

Rollout strategy:
1. extract modules incrementally behind the current command contract
2. keep wrappers and installer behavior stable
3. run smoke tests after each extraction milestone
4. avoid mixing new feature work with boundary extraction where possible

## 10. Session Guide

### Module Map
- module-1: `lib/store/*` extraction
- module-2: `lib/usage/*` extraction
- module-3: `lib/output/*` extraction
- module-4: `lib/actions/*` extraction
- module-5: installer/wrapper cleanup
- module-6: smoke test consolidation

### Recommended Session Plan
1. Session 1 — store extraction
2. Session 2 — usage extraction
3. Session 3 — output extraction
4. Session 

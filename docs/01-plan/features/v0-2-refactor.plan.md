# v0-2-refactor Plan

Status: draft
Date: 2026-04-02
Feature: v0-2-refactor

## Executive Summary

| Perspective | Summary |
|---|---|
| Problem | `cc-switch.cjs` and the installer layer now mix too many concerns: account store persistence, live file mutation, usage fetch logic, formatting, wrapper generation, startup hooks, and status line integration. This increases regression risk every time a feature is added. |
| Solution | Refactor the project into clear internal modules: store, usage, output, command actions, and installer adapters. Preserve all current user-facing behavior while reducing cross-cutting change risk. |
| Function UX Effect | Existing commands and flows (`cc-switch`, `ccs`, `cc-sync-oauth`, `/cc-switch`, startup guidance, status line prepend) remain available. The goal is safer internals, not a visible rewrite. |
| Core Value | Faster maintenance, fewer regressions, clearer ownership of responsibilities, and a stable base for future features like direct non-AI execution hooks, better HUD integrations, and stronger cross-platform behavior. |

## Context Anchor

| WHY | WHO | RISK | SUCCESS | SCOPE |
|---|---|---|---|---|
| The utility has outgrown its original monolithic structure and now needs architectural separation to keep shipping safely. | Maintainers of this repository and users relying on account switching, usage, status line, and startup guidance. | Refactor could break user-visible commands, installer behavior, or stored account data if boundaries are changed carelessly. | Internal modules are clearly separated, existing commands still work, and future changes no longer require touching unrelated parts of the system. | Runtime decomposition first, installer coupling reduction second, no full rewrite, no distribution model redesign in this cycle. |

## 1. Problem Statement

The project evolved rapidly through several versions:
- PowerShell-based core to Node.js core
- direct `.claude.json` usage to dedicated `~/.ClaudeCodeMultiAccounts.json` storage
- shell commands, short aliases, startup reminders, status line integration, and slash-command wrappers
- usage/limit display, timestamps, removal, and reset estimation

This feature growth left the internal structure highly coupled. The most significant issue is that `cc-switch.cjs` currently owns:
- argument parsing
- settings persistence
- account snapshot storage
- live credential switching
- usage API integration
- rate-limit reset caching
- formatting and output rendering
- command routing (`sync`, `usage`, `remove`, switching)

The installer layer also knows too much about runtime details, including wrapper generation, hooks, status line wrapping, and compatibility cleanup.

## 2. Goals

### 2.1 Primary goals
1. Split the runtime into modules with explicit responsibilities.
2. Keep all current public commands and behaviors intact.
3. Reduce coupling between installer code and runtime internals.
4. Make usage refresh, cache fallback, and account-store behavior independently testable.
5. Lower the risk of regressions when adding future features.

### 2.2 Secondary goals
1. Make output behavior easier to reason about.
2. Simplify smoke testing for Windows / Git Bash / WSL paths.
3. Prepare a cleaner base for future non-AI hook work and richer HUD/status line integrations.

## 3. Non-Goals

This refactor does **not** aim to:
- rewrite the tool from scratch
- redesign the installer UX
- replace npm distribution
- remove slash-command compatibility
- redesign status line or startup guidance UX
- implement native macOS/Linux-specific architecture beyond current support
- introduce plugin packaging or marketplace distribution

## 4. Scope

### 4.1 In scope
- Extract store operations from `cc-switch.cjs`
- Extract usage/limits logic from `cc-switch.cjs`
- Extract output formatting helpers from `cc-switch.cjs`
- Extract command action handlers (`sync`, `switch`, `remove`, `usage`) from `cc-switch.cjs`
- Reduce installer knowledge of command/runtime business logic
- Add targeted smoke tests around the extracted seams

### 4.2 Out of scope
- full UI/HUD redesign
- replacing the shell-first command model
- changing the user-facing command set
- changing the store format again in the same cycle unless strictly required

## 5. Current System Snapshot

### 5.1 Main runtime surfaces
- `cc-switch.cjs` — main runtime entrypoint and current “god file”
- `install.cjs` / `uninstall.cjs` — installer orchestration and wrapper generation
- `statusline.cjs` — status line prepend wrapper
- `session-start.cjs` — startup guidance
- `install.cmd` / `install.sh` — platform entrypoints

### 5.2 Main storage surfaces
- `~/.ClaudeCodeMultiAccounts.json` — account snapshot store (authoritative)
- `~/.claude.json` — active Claude metadata target only
- `~/.claude/.credentials.json` — active Claude credentials target only
- `~/.claude/multi-account-switch/settings.json` — local tool settings and rate-limit reset cache

## 6. Core Architectural Problems

### 6.1 Runtime monolith
`cc-switch.cjs` currently combines domain logic, IO, persistence, network, and presentation. This makes feature work fragile and increases review cost.

### 6.2 Installer/runtime coupling
`install.cjs` currently embeds too much knowledge about command wrappers, slash-command markdown generation, startup hooks, and status line behavior.

### 6.3 Usage logic complexity
Usage now has multiple representations:
- live fetched usage
- cached usage snapshot per account
- inferred reset windows
- current-account override behavior
This logic needs a dedicated home to remain understandable.

## 7. Refactor Strategy

### Phase A — Runtime decomposition
1. `lib/store/*`
   - read/write store
   - syncFromLive
   - switchToStoredAccount
   - removeAccount
2. `lib/usage/*`
   - fetch usage
   - stale-cache retention
   - rate-limit reset caching
   - compact usage formatting helpers
3. `lib/output/*`
   - account list rendering
   - usage block rendering
   - user-facing guidance text
4. `lib/commands/*`
   - switch action
   - sync action
   - remove action
   - usage action

### Phase B — Adapter cleanup
5. Shrink `cc-switch.cjs` into a CLI adapter only.
6. Shrink installer scripts into setup adapters only.
7. Centralize generated wrappers and command markdown templates.

### Phase C — Verification hardening
8. Add and standardize smoke tests for:
   - sync / switch / remove store flows
   - usage refresh and stale fallback
   - current-account-only reset behavior
   - startup hook and status line wrapper installation
   - short alias and slash-command generation

## 8. Risks and Mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Behavior regression | Users already rely on small command semantics and installer side effects. | Preserve public commands as a contract and add smoke tests before/after each extraction. |
| Store corruption | Refactor may accidentally alter authoritative account snapshots. | Extract storage logic first and cover it with fixture-based tests before broader changes. |
| Installer breakage | Current install flow touches commands, hooks, and status line. | Delay installer simplification until runtime seams are stable. |
| Scope creep | “Refactor everything” can expand endlessly. | Time-box to boundary extraction, not UX redesign. |

## 9. Success Criteria

1. `cc-switch.cjs` becomes a thin adapter rather than the main implementation container.
2. Store, usage, and output logic are independently testable.
3. Existing public commands still work after refactor.
4. Installer changes are reduced to wiring and setup concerns.
5. Future features can be added without changing unrelated layers.

## 10. Work Breakdown

### Milestone 1 — Store split
- extract store persistence module
- extract sync/switch/remove primitives
- add fixture tests for store behavior

### Milestone 2 — Usage split
- extract usage fetch logic
- extract stale-cache and reset rules
- verify current-account override logic

### Milestone 3 — Output split
- extract list formatter
- extract usage formatter
- keep command contract stable

### Milestone 4 — Installer cl

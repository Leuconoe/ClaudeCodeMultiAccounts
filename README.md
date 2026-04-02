# Claude Code Multi-Account Switcher

[![npm version](https://img.shields.io/npm/v/claude-code-multi-accounts?label=npm)](https://www.npmjs.com/package/claude-code-multi-accounts)

This project installs a local workaround for switching Claude Code OAuth accounts by keeping account snapshots in `~/.ClaudeCodeMultiAccounts.json` and writing only the active account back into Claude's live files when switching.

Supported user-facing commands:
- `cc-switch`
- `cc-switch <index>`
- `cc-sync-oauth`
- `ccs` (short alias for `cc-switch`)
- `ccso` (short alias for `cc-sync-oauth`)
- `/cc-switch`
- `/cc-sync-oauth`

Supported environments:
- Windows (PowerShell/CMD/Git Bash)
- Ubuntu WSL
- Native macOS/Linux with Node.js
- Claude chat shell mode via `!cc-switch` and `!cc-sync-oauth`

Prerequisites:
- Node.js 18+
- Claude Code already installed and logged in at least once

Install:

```powershell
./install.cmd
```

```bash
./install.sh
```

```bash
npx claude-code-multi-accounts install
```

What install does:
- copies the Node CLI into `~/.claude/multi-account-switch/bin`
- installs `cc-switch`, `cc-sync-oauth`, `ccs`, and `ccso` wrapper commands
- keeps stored account snapshots in `~/.ClaudeCodeMultiAccounts.json`
- adds an `auth_success` hook entry to `~/.claude/settings.json`
- adds a `SessionStart` reminder hook to `~/.claude/settings.json`
- if `statusLine.command` already exists, wraps it and prepends `use !cc-switch / !ccs` to the existing HUD output
- installs global Claude command wrappers in `~/.claude/commands`
- creates backups under `~/.claude/backups/multi-account-switch-installer`

Uninstall:

```powershell
./uninstall.cmd
```

```bash
./uninstall.sh
```

```bash
npx claude-code-multi-accounts uninstall
```

Usage:

```bash
cc-switch
cc-switch 1
cc-sync-oauth
ccs
ccso
```

Example shell output:

```text
$ cc-switch
--- Usage ---
Usage API is rate limited. Resets in ~45m 22s (at 10:52 PM).

Available Claude accounts:
* [0] Alex Example <alex@example.invalid> - Example Workspace - Pro | synced: just now | used: 3h ago | reset: ~45m 22s
  [1] Taylor Example <taylor@example.invalid> - Example Workspace - Teams | synced: never | used: never | reset: ~6d 17h
  [2] Jordan Example <jordan@example.invalid> - Example Workspace - Enterprise | synced: 1d ago | used: never | reset: ~5d 12h

Run cc-switch <index> to make one of these stored entries the active Claude account.
```

```text
$ cc-switch 1
Switched active account to [1] Taylor Example <taylor@example.invalid> (Teams).

Stored account list:
  [0] Alex Example <alex@example.invalid> - Example Workspace - Pro | synced: just now | used: 3h ago | reset: unknown
* [1] Taylor Example <taylor@example.invalid> - Example Workspace - Teams | synced: never | used: just now | reset: unknown
  [2] Jordan Example <jordan@example.invalid> - Example Workspace - Enterprise | synced: 1d ago | used: never | reset: unknown
```

Output columns:
- `synced`: When the account was last synced into the store
- `used`: When the account was last selected via switch
- `reset`: Rate limit reset countdown (current account only) or 7-day window estimate

Claude chat shell usage:

```bash
!cc-switch
!cc-switch 1
!cc-sync-oauth
!ccs
!ccso
```

Claude `/command` usage:

```text
/cc-switch
/cc-switch 1
/cc-sync-oauth
```

`/cc-switch` currently still goes through Claude's command-processing path, so `!cc-switch` remains the primary deterministic execution path. The slash command is installed now so it can benefit from future improvements in Claude's command handling.

Claude startup reminder:

```text
Claude Code Multi-Account Switcher is available.
Use !cc-switch or !ccs to list/switch accounts.
Use !cc-sync-oauth or !ccso to sync the active account into oauthList.
```

Platform notes:
- Windows installs `cc-switch.cmd` and `cc-sync-oauth.cmd` into `~/bin`, plus Git Bash-friendly `cc-switch` and `cc-sync-oauth` wrappers in the same directory.
- Short aliases `ccs` and `ccso` are installed alongside the full command names.
- Native macOS/Linux installs commands into `~/.local/bin`.
- WSL also uses the Unix shell wrappers.
- If a shell says `command not found` right after install, restart the shell or run `hash -r` once.

Behavior notes:
- The tool stores metadata and credential snapshots in `~/.ClaudeCodeMultiAccounts.json`.
- `cc-sync-oauth` imports the current live account into that store.
- Switching writes only the active `oauthAccount` back into `~/.claude.json` and the active credential snapshot back into `~/.claude/.credentials.json`.
- It creates backups before writing live files or the store file.
- Stored account ordering is stable.
- If a stored `displayName` is already corrupted, output falls back to the email local part.
- The displayed plan type is a best-effort inference from the available account fields and credential snapshot.
- The `reset:` column shows rate limit countdown for the current account, or a 7-day window estimate for others.
- Usage info from the Claude API is shown before the account list when rate limited.

Warnings:
- This is a local workaround, not an official Claude plugin.
- It still mutates internal Claude live files when switching accounts, but it no longer uses `~/.claude.json` as the primary multi-account store.
- Native macOS/Linux support is implemented, but still needs real-host validation beyond Windows/WSL testing.
- npm packaging is prepared, but npm registry publish still requires npm authentication.

After this:
- npm / `npx` release refresh for `v0.2.3`
- non-AI hook execution path for `/cc-switch` if Claude exposes a direct command hook in the future
- improve plan type detection beyond the current best-effort inference

## Star History

<a href="https://www.star-history.com/?repos=Leuconoe%2FClaudeCodeMultiAccounts&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
 </picture>
</a>

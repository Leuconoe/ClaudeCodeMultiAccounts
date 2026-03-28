# Claude Code Multi-Account Switcher

This project installs a local workaround for switching Claude Code OAuth accounts by updating `~/.claude.json`.

Supported user-facing commands:
- `cc-switch`
- `cc-switch <index|email|accountUuid>`
- `cc-sync-oauth`
- `ccs` (short alias for `cc-switch`)
- `ccso` (short alias for `cc-sync-oauth`)

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
- adds an `auth_success` hook entry to `~/.claude/settings.json`
- adds a `SessionStart` reminder hook to `~/.claude/settings.json`
- if `statusLine.command` already exists, wraps it and prepends `use !cc-switch / !ccs` to the existing HUD output
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
Available Claude accounts:
* [0] Alex Example <alex@example.invalid> - Example Workspace - Pro
  [1] Taylor Example <taylor@example.invalid> - Example Workspace - Teams
  [2] Jordan Example <jordan@example.invalid> - Example Workspace - Enterprise

Run cc-switch <index|email|accountUuid> to make one of these entries the active oauthAccount.
```

```text
$ cc-switch 1
Switched active oauthAccount to [1] Taylor Example <taylor@example.invalid> (Teams).

Current account list:
  [0] Alex Example <alex@example.invalid> - Example Workspace - Pro
* [1] Taylor Example <taylor@example.invalid> - Example Workspace - Teams
  [2] Jordan Example <jordan@example.invalid> - Example Workspace - Enterprise
```

Claude chat shell usage:

```bash
!cc-switch
!cc-switch 1
!cc-sync-oauth
!ccs
!ccso
```

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
- The tool updates only `oauthList` and `oauthAccount` inside `~/.claude.json`.
- It preserves stable account ordering instead of moving the active account to the end on every sync.
- It creates a backup before writing.
- If a stored `displayName` is already corrupted, output falls back to the email local part.
- The displayed plan type is a best-effort inference from the available account fields.

Warnings:
- This is a local workaround, not an official Claude plugin.
- It mutates internal Claude config files.
- Native macOS/Linux support is implemented, but still needs real-host validation beyond Windows/WSL testing.
- npm packaging is prepared, but npm registry publish still requires npm authentication.

After this:
- npm publish / `npx` distribution
- plan type exposure (`Pro`, `Max`, `Teams`, `Enterprise`)

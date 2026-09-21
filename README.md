# Claude Code Multi-Account Switcher

[![npm version](https://img.shields.io/npm/v/claude-code-multi-accounts?label=npm)](https://www.npmjs.com/package/claude-code-multi-accounts)
[![npm downloads](https://img.shields.io/npm/dm/claude-code-multi-accounts)](https://www.npmjs.com/package/claude-code-multi-accounts)

Switch between several Claude Code OAuth accounts from the terminal or from inside a Claude Code session.
Account snapshots live in `~/.ClaudeCodeMultiAccounts.json`; switching writes only the active account back into Claude's live files.

Works on Windows (PowerShell / CMD / Git Bash), WSL, macOS, and Linux. Requires Node.js 18+ and a Claude Code that has logged in at least once.

## Install

```bash
npx claude-code-multi-accounts install
```

This installs two commands, `ccs` and `ccso`, adds an `auth_success` hook that captures each new login automatically, and adds a short `SessionStart` reminder. Backups of `~/.claude/settings.json` go to `~/.claude/backups/multi-account-switch-installer`.

If a shell says `command not found` right after install, open a new terminal.

## Usage

```bash
ccs                        # list stored accounts with usage
ccs 1                      # switch to account [1]
ccs --rename 1 Personal    # label an account (omit the name to clear it)
ccs --remove 1             # forget a stored account
ccso                       # sync the current live login into the store
```

Inside Claude Code, prefix with `!`:

```text
!ccs
!ccs 1
!ccso
```

Log into each account once in Claude Code (`/login`); the hook stores it. From then on switch with `ccs <index>`.

> **Deprecated:** the long-form commands `cc-switch` and `cc-sync-oauth` are still installed as aliases of `ccs` and `ccso`, but they will be removed in a future release. Switch to the short names.

Example:

```text
$ ccs
--- Usage ---
5h remaining/reset: 78.0% / 2026. 4. 22. 2:00 PM
7d remaining/reset: 94.0% / 2026. 4. 24. 9:00 AM

Available Claude accounts:
* [0] Alex Example | Pro | 5H:78%(~2h 44min) | 7D:94%(1D 21h) | used:3m ago
  [1] Taylor Example | Team Std | 5H:71%(now) | 7D:81%(1D 21h) | used:19h ago
  [2] Jordan Example | Team Prem | 5H:0%(now) | 7D:65%(2D 5h) | used:1d ago

Run ccs <index> to make one of these stored entries the active Claude account.
Run ccs --remove <index> to remove a stored account.
```

Columns: `5H` / `7D` are the remaining 5-hour and 7-day quota with a reset estimate (cached for non-active accounts); `used` is when the account was last active. The plan label is a best-effort guess.

## Notes

- Switching while Claude Code is running is refused; the switch is staged and applied automatically once every Claude Code window closes. `ccs cancel` discards it.
- Every write to a live file or the store is backed up first.
- This is a local workaround, not an official Claude feature. It edits `~/.claude.json` and `~/.claude/.credentials.json`.

## Uninstall

```bash
npx claude-code-multi-accounts uninstall
```

## Star History

<a href="https://www.star-history.com/?repos=Leuconoe%2FClaudeCodeMultiAccounts&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Leuconoe/ClaudeCodeMultiAccounts&type=date&legend=top-left" />
 </picture>
</a>

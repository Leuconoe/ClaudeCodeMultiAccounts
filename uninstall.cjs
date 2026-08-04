#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Mirrors the install-time PATH entry so uninstalling leaves no trace.
function removeUserPathEntry(dir) {
  if (process.platform !== 'win32') return { changed: false };
  try {
    const query = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const match = query.match(/Path\s+REG(_EXPAND)?_SZ\s+(.*)/i);
    if (!match) return { changed: false };
    const normalized = dir.replace(/\\+$/, '').toLowerCase();
    const entries = match[2].trim().split(';').map((part) => part.trim()).filter(Boolean);
    const kept = entries.filter((entry) => entry.replace(/\\+$/, '').toLowerCase() !== normalized);
    if (kept.length === entries.length) return { changed: false };
    const type = match[1] ? 'REG_EXPAND_SZ' : 'REG_SZ';
    execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', type, '/d', kept.join(';'), '/f'], { windowsHide: true });
    return { changed: true };
  } catch {
    return { changed: false };
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function backupFile(filePath, backupDir) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  fs.copyFileSync(filePath, path.join(backupDir, `${path.basename(filePath)}.${timestamp}.bak`));
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function uninstallCommands() {
  const home = os.homedir();
  const installRoot = path.join(home, '.claude', 'multi-account-switch');
  const commandsDir = path.join(home, '.claude', 'commands');
  const userBinDir = process.platform === 'win32' ? path.join(home, 'bin') : path.join(home, '.local', 'bin');
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const backupDir = path.join(home, '.claude', 'backups', 'multi-account-switch-installer');
  const statuslineTargetPath = path.join(installRoot, 'hooks', 'statusline-target.json');
  const hookCommand = process.platform === 'win32'
    ? `node "${path.join(installRoot, 'bin', 'cc-switch.cjs')}" sync`
    : `node '${path.join(installRoot, 'bin', 'cc-switch.cjs')}' sync`;
  const startupHookCommand = process.platform === 'win32'
    ? `node "${path.join(installRoot, 'hooks', 'session-start.cjs')}"`
    : `node '${path.join(installRoot, 'hooks', 'session-start.cjs')}'`;
  const statusLineCommand = process.platform === 'win32'
    ? `node "${path.join(installRoot, 'hooks', 'statusline.cjs')}"`
    : `node '${path.join(installRoot, 'hooks', 'statusline.cjs')}'`;

  if (fs.existsSync(settingsPath)) {
    backupFile(settingsPath, backupDir);
    const settings = readJson(settingsPath, {});
    if (settings.hooks && Array.isArray(settings.hooks.Notification)) {
      settings.hooks.Notification = settings.hooks.Notification
        .map((entry) => {
          if (!entry || entry.matcher !== 'auth_success' || !Array.isArray(entry.hooks)) {
            return entry;
          }
          const nextHooks = entry.hooks.filter((hook) => !(hook && hook.type === 'command' && hook.command === hookCommand));
          return nextHooks.length > 0 ? { ...entry, hooks: nextHooks } : null;
        })
        .filter(Boolean);
    }
    if (settings.hooks && Array.isArray(settings.hooks.SessionStart)) {
      settings.hooks.SessionStart = settings.hooks.SessionStart
        .map((entry) => {
          if (!entry || entry.matcher !== 'startup' || !Array.isArray(entry.hooks)) {
            return entry;
          }
          const nextHooks = entry.hooks.filter((hook) => !(hook && hook.type === 'command' && hook.command === startupHookCommand));
          return nextHooks.length > 0 ? { ...entry, hooks: nextHooks } : null;
        })
        .filter(Boolean);
    }

    if (settings.statusLine?.type === 'command' && settings.statusLine.command === statusLineCommand) {
      if (fs.existsSync(statuslineTargetPath)) {
        settings.statusLine = readJson(statuslineTargetPath, settings.statusLine);
      } else {
        delete settings.statusLine;
      }
    }

    writeJson(settingsPath, settings);
  }

  for (const name of ['cc-switch', 'cc-sync-oauth', 'ccs', 'ccso', 'cc-switch.cmd', 'cc-sync-oauth.cmd', 'ccs.cmd', 'ccso.cmd']) {
    const target = path.join(userBinDir, name);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }

  for (const name of ['cc-switch.md', 'cc-sync-oauth.md']) {
    const target = path.join(commandsDir, name);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
    }
  }

  if (fs.existsSync(installRoot)) {
    fs.rmSync(installRoot, { recursive: true, force: true });
  }

  if (removeUserPathEntry(userBinDir).changed) {
    console.log(`Removed ${userBinDir} from your user PATH.`);
  }

  console.log('Uninstalled multi-account switcher.');
}

uninstallCommands();

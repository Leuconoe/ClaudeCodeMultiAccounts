#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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

function writeFileExecutable(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o755);
  }
}

// The launchers land in %USERPROFILE%\bin, which Git Bash adds to PATH on its
// own but cmd/PowerShell do not — so `ccs` only worked inside Claude Code.
function ensureUserPathEntry(dir) {
  if (process.platform !== 'win32') return { changed: false, reason: 'not windows' };
  try {
    const query = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', 'Path'], { encoding: 'utf8', windowsHide: true });
    const match = query.match(/Path\s+REG(_EXPAND)?_SZ\s+(.*)/i);
    const current = match ? match[2].trim() : '';
    const entries = current.split(';').map((part) => part.trim()).filter(Boolean);
    const normalized = dir.replace(/\\+$/, '').toLowerCase();
    if (entries.some((entry) => entry.replace(/\\+$/, '').toLowerCase() === normalized)) {
      return { changed: false, reason: 'already present' };
    }
    const next = entries.concat(dir).join(';');
    const type = match && match[1] ? 'REG_EXPAND_SZ' : 'REG_SZ';
    execFileSync('reg', ['add', 'HKCU\\Environment', '/v', 'Path', '/t', type, '/d', next, '/f'], { windowsHide: true });
    return { changed: true };
  } catch (error) {
    return { changed: false, reason: error.message };
  }
}

// Older releases wrapped statusLine.command; put the user's original back.
function restoreLegacyStatusLine(settings, hooksDir) {
  const legacyCommand = process.platform === 'win32'
    ? `node "${path.join(hooksDir, 'statusline.cjs')}"`
    : `node '${path.join(hooksDir, 'statusline.cjs')}'`;
  const targetPath = path.join(hooksDir, 'statusline-target.json');
  if (settings.statusLine?.type === 'command' && settings.statusLine.command === legacyCommand) {
    const original = readJson(targetPath, null);
    if (original) settings.statusLine = original;
    else delete settings.statusLine;
  }
  fs.rmSync(targetPath, { force: true });
  fs.rmSync(path.join(hooksDir, 'statusline.cjs'), { force: true });
}

function installCommands() {
  const repoRoot = __dirname;
  const home = os.homedir();
  const installRoot = path.join(home, '.claude', 'multi-account-switch');
  const binDir = path.join(installRoot, 'bin');
  const hooksDir = path.join(installRoot, 'hooks');
  const userBinDir = process.platform === 'win32' ? path.join(home, 'bin') : path.join(home, '.local', 'bin');
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const backupDir = path.join(home, '.claude', 'backups', 'multi-account-switch-installer');
  const cliTarget = path.join(binDir, 'cc-switch.cjs');
  const sessionStartTarget = path.join(hooksDir, 'session-start.cjs');
  const q = process.platform === 'win32' ? '"' : "'";
  const hookCommand = `node ${q}${cliTarget}${q} sync`;
  const startupHookCommand = `node ${q}${sessionStartTarget}${q}`;
  const legacyHookCommands = [
    `& '${path.join(home, '.claude', 'hooks', 'sync-auth.ps1')}'`,
    `& '${path.join(installRoot, 'hooks', 'sync-auth.ps1')}'`,
    `& '${path.join(userBinDir, 'cc-sync-oauth.cmd')}'`,
    path.join(userBinDir, 'cc-sync-oauth')
  ];

  ensureDir(binDir);
  ensureDir(hooksDir);
  ensureDir(userBinDir);
  fs.copyFileSync(path.join(repoRoot, 'cc-switch.cjs'), cliTarget);
  fs.cpSync(path.join(repoRoot, 'lib'), path.join(binDir, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'session-start.cjs'), sessionStartTarget);

  // cc-switch / cc-sync-oauth are deprecated aliases kept for existing users.
  const launchers = { ccs: '', ccso: 'sync ', 'cc-switch': '', 'cc-sync-oauth': 'sync ' };
  for (const [name, subcommand] of Object.entries(launchers)) {
    const sh = `#!/usr/bin/env bash\nset -euo pipefail\nnode '${cliTarget.replace(/\\/g, '/')}' ${subcommand}"$@"\n`;
    writeFileExecutable(path.join(userBinDir, name), sh);
    if (process.platform === 'win32') {
      writeFileExecutable(path.join(userBinDir, `${name}.cmd`), `@echo off\r\nnode "${cliTarget}" ${subcommand}%*\r\n`);
    }
  }

  backupFile(settingsPath, backupDir);
  const settings = readJson(settingsPath, {});
  settings.$schema ||= 'https://json.schemastore.org/claude-code-settings.json';
  settings.hooks ||= {};
  settings.hooks.Notification ||= [];
  settings.hooks.SessionStart ||= [];
  restoreLegacyStatusLine(settings, hooksDir);

  let matcher = settings.hooks.Notification.find((entry) => entry && entry.matcher === 'auth_success');
  if (!matcher) {
    matcher = { matcher: 'auth_success', hooks: [] };
    settings.hooks.Notification.push(matcher);
  }
  matcher.hooks = Array.isArray(matcher.hooks)
    ? matcher.hooks.filter((hook) => !(hook && hook.type === 'command' && legacyHookCommands.includes(hook.command)))
    : [];

  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const exists = matcher.hooks.find((hook) => hook && hook.type === 'command' && hook.command === hookCommand);
  if (!exists) {
    matcher.hooks.push({ type: 'command', shell, command: hookCommand });
  }

  let startupMatcher = settings.hooks.SessionStart.find((entry) => entry && entry.matcher === 'startup');
  if (!startupMatcher) {
    startupMatcher = { matcher: 'startup', hooks: [] };
    settings.hooks.SessionStart.push(startupMatcher);
  }
  startupMatcher.hooks = Array.isArray(startupMatcher.hooks) ? startupMatcher.hooks : [];
  const startupExists = startupMatcher.hooks.find((hook) => hook && hook.type === 'command' && hook.command === startupHookCommand);
  if (!startupExists) {
    startupMatcher.hooks.push({ type: 'command', shell, command: startupHookCommand });
  }

  writeJson(settingsPath, settings);

  console.log(`Installed multi-account switcher scripts to ${installRoot}`);
  console.log('Installed commands: ccs, ccso (cc-switch and cc-sync-oauth are deprecated aliases)');

  const pathResult = ensureUserPathEntry(userBinDir);
  if (pathResult.changed) {
    console.log(`Added ${userBinDir} to your user PATH. Open a new terminal for 'ccs' to resolve there.`);
  } else if (process.platform === 'win32' && pathResult.reason !== 'already present') {
    console.log(`Note: could not add ${userBinDir} to your user PATH (${pathResult.reason}). Add it manually to run 'ccs' from cmd/PowerShell.`);
  }
}

installCommands();

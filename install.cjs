#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

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

function installCommands() {
  const repoRoot = __dirname;
  const home = os.homedir();
  const installRoot = path.join(home, '.claude', 'multi-account-switch');
  const binDir = path.join(installRoot, 'bin');
  const binLibStoreDir = path.join(binDir, 'lib', 'store');
  const binLibUsageDir = path.join(binDir, 'lib', 'usage');
  const binLibOutputDir = path.join(binDir, 'lib', 'output');
  const hooksDir = path.join(installRoot, 'hooks');
  const commandsDir = path.join(home, '.claude', 'commands');
  const userBinDir = process.platform === 'win32' ? path.join(home, 'bin') : path.join(home, '.local', 'bin');
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const backupDir = path.join(home, '.claude', 'backups', 'multi-account-switch-installer');
  const cliSource = path.join(repoRoot, 'cc-switch.cjs');
  const storeIoSource = path.join(repoRoot, 'lib', 'store', 'io.cjs');
  const storeAccountsSource = path.join(repoRoot, 'lib', 'store', 'accounts.cjs');
  const usageCacheSource = path.join(repoRoot, 'lib', 'usage', 'cache.cjs');
  const usageFetchSource = path.join(repoRoot, 'lib', 'usage', 'fetch.cjs');
  const usageFormatSource = path.join(repoRoot, 'lib', 'usage', 'format.cjs');
  const outputAccountsSource = path.join(repoRoot, 'lib', 'output', 'accounts.cjs');
  const outputUsageSource = path.join(repoRoot, 'lib', 'output', 'usage.cjs');
  const outputMessagesSource = path.join(repoRoot, 'lib', 'output', 'messages.cjs');
  const sessionStartSource = path.join(repoRoot, 'session-start.cjs');
  const statuslineSource = path.join(repoRoot, 'statusline.cjs');
  const cliTarget = path.join(binDir, 'cc-switch.cjs');
  const sessionStartTarget = path.join(hooksDir, 'session-start.cjs');
  const statuslineTarget = path.join(hooksDir, 'statusline.cjs');
  const statuslineTargetConfigPath = path.join(hooksDir, 'statusline-target.json');
  const hookCommand = process.platform === 'win32'
    ? `node "${cliTarget}" sync`
    : `node '${cliTarget}' sync`;
  const startupHookCommand = process.platform === 'win32'
    ? `node "${sessionStartTarget}"`
    : `node '${sessionStartTarget}'`;
  const legacyHookCommands = [
    `& '${path.join(home, '.claude', 'hooks', 'sync-auth.ps1')}'`,
    `& '${path.join(installRoot, 'hooks', 'sync-auth.ps1')}'`,
    `& '${path.join(userBinDir, 'cc-sync-oauth.cmd')}'`,
    path.join(userBinDir, 'cc-sync-oauth')
  ];

  ensureDir(binDir);
  ensureDir(binLibStoreDir);
  ensureDir(binLibUsageDir);
  ensureDir(binLibOutputDir);
  ensureDir(hooksDir);
  ensureDir(commandsDir);
  ensureDir(userBinDir);
  fs.copyFileSync(cliSource, cliTarget);
  fs.copyFileSync(storeIoSource, path.join(binLibStoreDir, 'io.cjs'));
  fs.copyFileSync(storeAccountsSource, path.join(binLibStoreDir, 'accounts.cjs'));
  fs.copyFileSync(usageCacheSource, path.join(binLibUsageDir, 'cache.cjs'));
  fs.copyFileSync(usageFetchSource, path.join(binLibUsageDir, 'fetch.cjs'));
  fs.copyFileSync(usageFormatSource, path.join(binLibUsageDir, 'format.cjs'));
  fs.copyFileSync(outputAccountsSource, path.join(binLibOutputDir, 'accounts.cjs'));
  fs.copyFileSync(outputUsageSource, path.join(binLibOutputDir, 'usage.cjs'));
  fs.copyFileSync(outputMessagesSource, path.join(binLibOutputDir, 'messages.cjs'));
  fs.copyFileSync(sessionStartSource, sessionStartTarget);
  fs.copyFileSync(statuslineSource, statuslineTarget);

  if (process.platform === 'win32') {
    const switchCmd = `@echo off\r\nnode "${cliTarget}" --usage-command "cc-switch" %*\r\n`;
    const syncCmd = `@echo off\r\nnode "${cliTarget}" sync %*\r\n`;
    const ccsCmd = `@echo off\r\nnode "${cliTarget}" --usage-command "ccs" %*\r\n`;
    const ccsoCmd = `@echo off\r\nnode "${cliTarget}" sync %*\r\n`;
    const switchSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget.replace(/\\/g, '/')}'\nnode "$script_path" --usage-command "cc-switch" "$@"\n`;
    const syncSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget.replace(/\\/g, '/')}'\nnode "$script_path" sync "$@"\n`;
    const ccsSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget.replace(/\\/g, '/')}'\nnode "$script_path" --usage-command "ccs" "$@"\n`;
    const ccsoSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget.replace(/\\/g, '/')}'\nnode "$script_path" sync "$@"\n`;

    writeFileExecutable(path.join(userBinDir, 'cc-switch.cmd'), switchCmd);
    writeFileExecutable(path.join(userBinDir, 'cc-sync-oauth.cmd'), syncCmd);
    writeFileExecutable(path.join(userBinDir, 'ccs.cmd'), ccsCmd);
    writeFileExecutable(path.join(userBinDir, 'ccso.cmd'), ccsoCmd);
    writeFileExecutable(path.join(userBinDir, 'cc-switch'), switchSh);
    writeFileExecutable(path.join(userBinDir, 'cc-sync-oauth'), syncSh);
    writeFileExecutable(path.join(userBinDir, 'ccs'), ccsSh);
    writeFileExecutable(path.join(userBinDir, 'ccso'), ccsoSh);
  } else {
    const switchSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget}'\nnode "$script_path" --usage-command "cc-switch" "$@"\n`;
    const syncSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget}'\nnode "$script_path" sync "$@"\n`;
    const ccsSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget}'\nnode "$script_path" --usage-command "ccs" "$@"\n`;
    const ccsoSh = `#!/usr/bin/env bash\nset -euo pipefail\nscript_path='${cliTarget}'\nnode "$script_path" sync "$@"\n`;

    writeFileExecutable(path.join(userBinDir, 'cc-switch'), switchSh);
    writeFileExecutable(path.join(userBinDir, 'cc-sync-oauth'), syncSh);
    writeFileExecutable(path.join(userBinDir, 'ccs'), ccsSh);
    writeFileExecutable(path.join(userBinDir, 'ccso'), ccsoSh);
  }

  const commandShell = process.platform === 'win32' ? 'node' : 'node';
  const switchCommandPathLiteral = process.platform === 'win32' ? cliTarget.replace(/\\/g, '/') : cliTarget;
  const switchCommandBody = process.platform === 'win32'
    ? `node "${cliTarget}" --usage-command "/cc-switch" $ARGUMENTS`
    : `node '${cliTarget}' --usage-command "/cc-switch" $ARGUMENTS`;
  const syncCommandBody = process.platform === 'win32'
    ? `node "${cliTarget}" sync`
    : `node '${cliTarget}' sync`;
  const switchAllowed = `Bash(${commandShell} ${switchCommandPathLiteral}:*)`;
  const syncAllowed = `Bash(${commandShell} ${switchCommandPathLiteral}:*)`;

  const switchCommandMarkdown = `---
description: Show saved Claude OAuth accounts and switch \`oauthAccount\` by index, email, or account UUID.
argument-hint: [index|email|accountUuid]
allowed-tools: ["${switchAllowed}"]
disable-model-invocation: true
---

Run the installed local switch command and use its output as the command result.

0!
${switchCommandBody}
0
`.replace(/\u00060!/g, '```!').replace(/\u00060\n/g, '```\n');

  const syncCommandMarkdown = `---
description: Sync the current Claude \`oauthAccount\` into \`oauthList\`.
allowed-tools: ["${syncAllowed}"]
disable-model-invocation: true
---

Run the installed local sync command and use its output as the command result.

0!
${syncCommandBody}
0
`.replace(/\u00060!/g, '```!').replace(/\u00060\n/g, '```\n');

  fs.writeFileSync(path.join(commandsDir, 'cc-switch.md'), switchCommandMarkdown, 'utf8');
  fs.writeFileSync(path.join(commandsDir, 'cc-sync-oauth.md'), syncCommandMarkdown, 'utf8');

  backupFile(settingsPath, backupDir);
  const settings = readJson(settingsPath, {});
  const existingStatusLine = settings.statusLine && typeof settings.statusLine === 'object' ? settings.statusLine : null;
  settings.$schema ||= 'https://json.schemastore.org/claude-code-settings.json';
  settings.hooks ||= {};
  settings.hooks.Notification ||= [];
  settings.hooks.SessionStart ||= [];

  const statusLineCommand = process.platform === 'win32'
    ? `node "${statuslineTarget}"`
    : `node '${statuslineTarget}'`;

  if (!existingStatusLine || existingStatusLine.command !== statusLineCommand) {
    if (existingStatusLine?.type === 'command' && existingStatusLine.command) {
      fs.writeFileSync(statuslineTargetConfigPath, `${JSON.stringify(existingStatusLine, null, 2)}\n`, 'utf8');
    } else if (fs.existsSync(statuslineTargetConfigPath)) {
      fs.rmSync(statuslineTargetConfigPath, { force: true });
    }

    settings.statusLine = {
      type: 'command',
      command: statusLineCommand
    };
  }

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
  console.log('Installed commands: cc-switch, cc-sync-oauth, ccs, ccso, /cc-switch, /cc-sync-oauth');
}

installCommands();

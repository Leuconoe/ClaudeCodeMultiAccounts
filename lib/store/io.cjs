const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_ITEM_NOT_FOUND = 'KEYCHAIN_ITEM_NOT_FOUND';

function getDefaultConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

function getDefaultCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function getDefaultStorePath() {
  return path.join(os.homedir(), '.ClaudeCodeMultiAccounts.json');
}

function getDefaultBackupDir() {
  return path.join(os.homedir(), '.claude', 'backups', 'multi-account-switch');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    // JSON.parse error messages quote the source text, which for the
    // credentials file would leak token fragments into console output.
    throw new Error(`Failed to parse ${path.basename(filePath)}: invalid JSON.`);
  }
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return readJson(filePath);
}

function credentialsUseKeychain(credentialsPath, platform = process.platform) {
  return platform === 'darwin' && !fs.existsSync(credentialsPath);
}

function keychainError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

function isMissingKeychainItem(error) {
  if (!error || error.code === 'ENOENT') return false;
  const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString('utf8') : String(error.stderr || '');
  return error.status === 44 || /item could not be found|item not found|no such item/i.test(stderr);
}

function runSecurity(args, action, execFileSync = childProcess.execFileSync) {
  try {
    return execFileSync('security', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (isMissingKeychainItem(error)) {
      throw keychainError(`The macOS keychain item for ${KEYCHAIN_SERVICE} was not found.`, KEYCHAIN_ITEM_NOT_FOUND);
    }
    throw keychainError(`Failed to ${action} macOS keychain credentials.`);
  }
}

function keychainAccount(execFileSync = childProcess.execFileSync) {
  let output;
  try {
    output = runSecurity(['find-generic-password', '-s', KEYCHAIN_SERVICE], 'inspect', execFileSync);
  } catch (error) {
    if (error.code === KEYCHAIN_ITEM_NOT_FOUND) return null;
    throw error;
  }
  const match = output.match(/"acct"<blob>="([^"]*)"/);
  if (!match || !match[1]) {
    throw keychainError(`The macOS keychain item for ${KEYCHAIN_SERVICE} has no account identifier.`);
  }
  return match[1];
}

function readKeychainCredentials(execFileSync = childProcess.execFileSync) {
  let raw;
  try {
    raw = runSecurity(
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      'read',
      execFileSync,
    );
  } catch (error) {
    throw error;
  }
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw keychainError('Failed to parse macOS keychain credentials: invalid JSON.');
  }
}

function writeKeychainCredentials(value, current, execFileSync = childProcess.execFileSync) {
  const account = keychainAccount(execFileSync);
  const next = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current, claudeAiOauth: value.claudeAiOauth }
    : value;
  runSecurity([
    'add-generic-password', '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', account,
    '-w', JSON.stringify(next),
  ], 'write', execFileSync);
}

function backupKeychainCredentials(backupDir, execFileSync = childProcess.execFileSync) {
  let value;
  try {
    value = readKeychainCredentials(execFileSync);
  } catch (error) {
    if (error.code === KEYCHAIN_ITEM_NOT_FOUND) return null;
    throw error;
  }
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  fs.writeFileSync(path.join(backupDir, `credentials-keychain.${timestamp}.bak`), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const backups = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith('credentials-keychain.') && name.endsWith('.bak'))
    .sort()
    .reverse();
  for (const stale of backups.slice(3)) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
  return value;
}

function readCredentials(credentialsPath, deps = {}) {
  const platform = deps.platform || process.platform;
  const execFileSync = deps.execFileSync || childProcess.execFileSync;
  if (credentialsUseKeychain(credentialsPath, platform)) {
    return readKeychainCredentials(execFileSync);
  }
  return readJson(credentialsPath);
}

function writeCredentials(credentialsPath, value, backupDir, deps = {}) {
  const platform = deps.platform || process.platform;
  const execFileSync = deps.execFileSync || childProcess.execFileSync;
  if (credentialsUseKeychain(credentialsPath, platform)) {
    const current = backupKeychainCredentials(backupDir, execFileSync);
    if (!current) {
      throw keychainError(`The macOS keychain item for ${KEYCHAIN_SERVICE} was not found.`);
    }
    writeKeychainCredentials(value, current, execFileSync);
    return;
  }
  backupFile(credentialsPath, backupDir);
  mergeCredentialsWrite(credentialsPath, value);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeJsonAtomic(filePath, value, options = {}) {
  ensureDir(path.dirname(filePath));
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  // The rename transfers the temp file's mode onto the target, so the temp
  // file must inherit the target's permissions (0600 on POSIX credentials
  // files) or they would be silently widened to the umask default.
  let mode = options.mode;
  try {
    mode = fs.statSync(filePath).mode & 0o777;
  } catch {
    // target does not exist yet; keep options.mode (or platform default)
  }
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, payload, mode !== undefined ? { encoding: 'utf8', mode } : 'utf8');
    if (mode !== undefined) {
      try { fs.chmodSync(tempPath, mode); } catch {}
    }
    fs.renameSync(tempPath, filePath);
  } catch {
    // Windows refuses the rename while another process holds the target open;
    // fall back to a direct overwrite rather than failing the switch. The
    // temp file must never linger — it may contain tokens.
    fs.rmSync(tempPath, { force: true });
    fs.writeFileSync(filePath, payload, 'utf8');
    if (mode !== undefined) {
      try { fs.chmodSync(filePath, mode); } catch {}
    }
  }
}

// Only claudeAiOauth belongs to this tool; sibling keys Claude Code may add
// to .credentials.json must survive a switch.
function mergeCredentialsWrite(credentialsPath, credentials) {
  let existing = null;
  try {
    existing = readJsonIfExists(credentialsPath, null);
  } catch {
    existing = null;
  }
  const next = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing, claudeAiOauth: credentials.claudeAiOauth }
    : credentials;
  writeJsonAtomic(credentialsPath, next, { mode: 0o600 });
}

function backupFile(filePath, backupDir) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const base = path.basename(filePath);
  fs.copyFileSync(filePath, path.join(backupDir, `${base}.${timestamp}.bak`));

  // Retention is per source file: the backup dir is shared, and a global
  // keep-3 would let one file's backups evict another's within one switch.
  const backups = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith(`${base}.`) && name.endsWith('.bak'))
    .sort()
    .reverse();

  for (const stale of backups.slice(3)) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeLiveState(config, credentials, options) {
  backupFile(options.configPath, options.backupDir);
  writeJsonAtomic(options.configPath, config);
  writeCredentials(options.credentialsPath, credentials, options.backupDir);
}

// A running Claude Code session rewrites ~/.claude.json wholesale, which can
// revert oauthAccount moments after a switch. Reading both files back is the
// only way to know the swap actually took hold.
function verifyLiveState(options, expected, deps = {}) {
  let config;
  let credentials;
  try {
    config = readJson(options.configPath);
    credentials = readCredentials(options.credentialsPath, deps);
  } catch (error) {
    return { ok: false, reason: `could not re-read the live files after writing (${error.message})` };
  }

  const liveUuid = config.oauthAccount && config.oauthAccount.accountUuid;
  if (liveUuid !== expected.accountUuid) {
    return {
      ok: false,
      reason: 'the live oauthAccount no longer matches the account just written (a running Claude Code session likely rewrote ~/.claude.json)',
    };
  }
  const liveToken = credentials.claudeAiOauth && credentials.claudeAiOauth.accessToken;
  if (liveToken !== expected.accessToken) {
    return {
      ok: false,
      reason: 'the live credentials no longer match the token just written (a running Claude Code session likely rewrote .credentials.json)',
    };
  }
  return { ok: true };
}

function writeStore(store, options) {
  backupFile(options.storePath, options.backupDir);
  writeJsonAtomic(options.storePath, store);
}

module.exports = {
  getDefaultConfigPath,
  getDefaultCredentialsPath,
  getDefaultStorePath,
  getDefaultBackupDir,
  ensureDir,
  readJson,
  readJsonIfExists,
  writeJson,
  writeJsonAtomic,
  mergeCredentialsWrite,
  backupFile,
  readCredentials,
  writeCredentials,
  backupKeychainCredentials,
  deepCopy,
  writeLiveState,
  verifyLiveState,
  writeStore,
};

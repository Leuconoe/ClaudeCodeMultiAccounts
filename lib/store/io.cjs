const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// --- macOS keychain bridge -------------------------------------------------
// On macOS, Claude Code stores OAuth credentials in the login keychain
// (service "Claude Code-credentials") instead of ~/.claude/.credentials.json.
// This bridge transparently routes credential reads/writes to the keychain
// when the file is absent, so the multi-account switcher works on macOS.

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function isMac() {
  return process.platform === 'darwin';
}

function keychainRead() {
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
    });
  } catch (err) {
    return null;
  }
}

function keychainAccount() {
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], {
      encoding: 'utf8',
    });
    const match = out.match(/"acct"<blob>="([^"]*)"/);
    if (match) return match[1];
  } catch (err) {
    /* fall through to default account */
  }
  return os.userInfo().username;
}

function keychainWrite(jsonString) {
  const account = keychainAccount();
  execFileSync('security', [
    'add-generic-password',
    '-U',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    account,
    '-w',
    jsonString,
  ]);
}

// Active only for the credentials file, on macOS, when no plaintext
// credentials file exists (i.e. the install relies on the keychain).
function keychainCredentialsActive(filePath) {
  return (
    isMac() &&
    path.basename(filePath) === '.credentials.json' &&
    !fs.existsSync(filePath) &&
    keychainRead() !== null
  );
}

function backupKeychainCredentials(backupDir) {
  const raw = keychainRead();
  if (raw === null) return;
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  fs.writeFileSync(path.join(backupDir, `keychain-credentials.${timestamp}.bak`), raw, 'utf8');

  const backups = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith('keychain-credentials.') && name.endsWith('.bak'))
    .sort()
    .reverse();

  for (const stale of backups.slice(3)) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
}
// ---------------------------------------------------------------------------

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
  if (keychainCredentialsActive(filePath)) {
    return JSON.parse(keychainRead());
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonIfExists(filePath, fallback) {
  if (keychainCredentialsActive(filePath)) {
    return JSON.parse(keychainRead());
  }
  if (!fs.existsSync(filePath)) return fallback;
  return readJson(filePath);
}

function writeJson(filePath, value) {
  if (keychainCredentialsActive(filePath)) {
    keychainWrite(JSON.stringify(value));
    return;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function backupFile(filePath, backupDir) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const base = path.basename(filePath);
  fs.copyFileSync(filePath, path.join(backupDir, `${base}.${timestamp}.bak`));

  const backups = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith('.bak'))
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
  if (keychainCredentialsActive(options.credentialsPath)) {
    backupKeychainCredentials(options.backupDir);
  } else {
    backupFile(options.credentialsPath, options.backupDir);
  }
  writeJson(options.configPath, config);
  writeJson(options.credentialsPath, credentials);
}

function writeStore(store, options) {
  backupFile(options.storePath, options.backupDir);
  writeJson(options.storePath, store);
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
  backupFile,
  deepCopy,
  writeLiveState,
  writeStore,
};

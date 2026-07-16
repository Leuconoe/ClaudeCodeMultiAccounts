const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const isDarwin = process.platform === 'darwin';

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
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return readJson(filePath);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function credentialsUseKeychain(credentialsPath) {
  return isDarwin && !fs.existsSync(credentialsPath);
}

function keychainAccount() {
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE], { encoding: 'utf8' });
    const match = out.match(/"acct"<blob>="([^"]*)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function readKeychainCredentials() {
  try {
    const raw = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' });
    return JSON.parse(raw.trim());
  } catch (err) {
    throw new Error(`Failed to read credentials from macOS keychain (service "${KEYCHAIN_SERVICE}"): ${err.message}`);
  }
}

function writeKeychainCredentials(value) {
  const account = keychainAccount() || os.userInfo().username || 'Claude Code';
  execFileSync('security', [
    'add-generic-password', '-U',
    '-s', KEYCHAIN_SERVICE,
    '-a', account,
    '-w', JSON.stringify(value),
  ]);
}

function backupKeychainCredentials(backupDir) {
  let value;
  try {
    value = readKeychainCredentials();
  } catch {
    return;
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
}

function readCredentials(credentialsPath) {
  if (credentialsUseKeychain(credentialsPath)) {
    return readKeychainCredentials();
  }
  return readJson(credentialsPath);
}

function writeCredentials(credentialsPath, value, backupDir) {
  if (credentialsUseKeychain(credentialsPath)) {
    backupKeychainCredentials(backupDir);
    writeKeychainCredentials(value);
    return;
  }
  backupFile(credentialsPath, backupDir);
  writeJson(credentialsPath, value);
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
  writeJson(options.configPath, config);
  writeCredentials(options.credentialsPath, credentials, options.backupDir);
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
  readCredentials,
  writeCredentials,
  deepCopy,
  writeLiveState,
  writeStore,
};

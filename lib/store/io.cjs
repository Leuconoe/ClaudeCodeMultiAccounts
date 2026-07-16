const fs = require('fs');
const os = require('os');
const path = require('path');

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
  backupFile(options.credentialsPath, options.backupDir);
  writeJsonAtomic(options.configPath, config);
  mergeCredentialsWrite(options.credentialsPath, credentials);
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
  deepCopy,
  writeLiveState,
  writeStore,
};

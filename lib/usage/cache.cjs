const fs = require('fs');
const os = require('os');
const path = require('path');

function getDefaultConfigDir() {
  return path.join(os.homedir(), '.claude', 'multi-account-switch');
}

function getSettingsPath() {
  return path.join(getDefaultConfigDir(), 'settings.json');
}

function readSettings() {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return { showUsage: true };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { showUsage: true };
  }
}

function writeSettings(settings, ensureDir) {
  const p = getSettingsPath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function getRateLimitResetAt() {
  const settings = readSettings();
  if (settings.rateLimitResetAt) {
    const resetTime = new Date(settings.rateLimitResetAt).getTime();
    if (resetTime > Date.now()) return resetTime;
  }
  return null;
}

function setRateLimitResetAt(retryAfterSecs, ensureDir) {
  const settings = readSettings();
  settings.rateLimitResetAt = new Date(Date.now() + retryAfterSecs * 1000).toISOString();
  writeSettings(settings, ensureDir);
}

function setRateLimitResetAtFromIso(isoString, ensureDir) {
  if (!isoString) return;
  const resetTime = new Date(isoString).getTime();
  if (!Number.isNaN(resetTime) && resetTime > Date.now()) {
    const settings = readSettings();
    settings.rateLimitResetAt = new Date(resetTime).toISOString();
    writeSettings(settings, ensureDir);
  }
}

module.exports = {
  getDefaultConfigDir,
  getSettingsPath,
  readSettings,
  writeSettings,
  getRateLimitResetAt,
  setRateLimitResetAt,
  setRateLimitResetAtFromIso,
};

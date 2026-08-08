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

// The OAuth token endpoint rate-limits per IP, and hammering it deepens the
// window for every account, so a 429 parks all refreshes for a while.
const TOKEN_COOLDOWN_MS = 5 * 60 * 1000;

function getTokenCooldownUntil() {
  const settings = readSettings();
  if (!settings.tokenCooldownUntil) return null;
  const until = new Date(settings.tokenCooldownUntil).getTime();
  return Number.isNaN(until) || until <= Date.now() ? null : until;
}

function setTokenCooldown(ensureDir) {
  const settings = readSettings();
  settings.tokenCooldownUntil = new Date(Date.now() + TOKEN_COOLDOWN_MS).toISOString();
  writeSettings(settings, ensureDir);
}

module.exports = {
  getDefaultConfigDir,
  getSettingsPath,
  getTokenCooldownUntil,
  setTokenCooldown,
  TOKEN_COOLDOWN_MS,
  readSettings,
  writeSettings,
  getRateLimitResetAt,
  setRateLimitResetAt,
  setRateLimitResetAtFromIso,
};

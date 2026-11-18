const { getEntryLabel, inferPlanType } = require('./accounts.cjs');
const { getAccountKey } = require('../store/accounts.cjs');
const { getSessionStatus } = require('../auth/guard.cjs');

function formatSessionInfo({ store, config, credentials, currentError }) {
  const metadata = config?.oauthAccount;
  const key = metadata ? getAccountKey(metadata) : null;
  const index = store.accounts.findIndex((entry) => entry.key === key);
  const entry = index >= 0 ? store.accounts[index] : null;
  const lines = ['--- Current session ---'];
  if (!metadata) {
    lines.push('Current account is unknown. Session renewal is required; log into Claude Code (/login).');
    return lines;
  }
  const displayEntry = entry || { metadata, credentials };
  const label = getEntryLabel(displayEntry);
  const email = metadata.emailAddress;
  lines.push(`Account: ${index >= 0 ? `[${index}] ` : ''}${label}${email ? ` (${email})` : ''} | ${inferPlanType(displayEntry)}`);
  const oauth = credentials?.claudeAiOauth;
  const rejected = currentError?.statusCode === 401;
  const status = getSessionStatus(oauth, entry?.needsReauth, rejected);
  lines.push(`Session: ${status}`);
  const savedOauth = oauth || entry?.credentials?.claudeAiOauth;
  for (const [name, value] of [['Access token expires', savedOauth?.expiresAt], ['Refresh token expires', savedOauth?.refreshTokenExpiresAt]]) {
    const date = new Date(Number(value));
    const formatted = Number(value) > 0 && Number.isFinite(date.getTime()) ? date.toLocaleString() : 'unknown';
    lines.push(`${name}${!oauth && savedOauth ? ' (stored)' : ''}: ${formatted}`);
  }
  if (status.includes('login required') || rejected) {
    lines.push("Session renewal is required. Log into this account in Claude Code (/login), then run 'ccso' to update its snapshot.");
  } else if (status.includes('refresh required')) {
    lines.push(index >= 0
      ? `Session renewal is required. Run 'ccs ${index}' to refresh this account; if renewal fails, use /login in Claude Code, then run 'ccso'.`
      : "Session renewal is required. Use /login in Claude Code, then run 'ccso'.");
  }
  return lines;
}

function getCurrentUsage(store, currentKey, currentUsage) {
  if (currentUsage) return { usage: currentUsage, cached: false };
  const usage = store.accounts.find((entry) => entry.key === currentKey)?.usageSnapshot;
  return { usage, cached: Boolean(usage) };
}

function getUsageHeading(usage, cached) {
  return cached ? `--- Usage (cached; fetched: ${usage.fetchedAt || 'unknown'}) ---` : '--- Usage ---';
}

module.exports = { formatSessionInfo, getCurrentUsage, getUsageHeading };

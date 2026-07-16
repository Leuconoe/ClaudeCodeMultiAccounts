const ACCESS_TOKEN_SAFETY_MS = 5 * 60 * 1000;

function assessCredentials(claudeAiOauth, now) {
  if (!claudeAiOauth || typeof claudeAiOauth !== 'object') {
    return { verdict: 'refresh-expired', reason: 'stored credentials are missing claudeAiOauth' };
  }
  if (!claudeAiOauth.refreshToken) {
    return { verdict: 'refresh-expired', reason: 'stored credentials have no refresh token' };
  }
  const refreshExpiresAt = Number(claudeAiOauth.refreshTokenExpiresAt);
  if (Number.isFinite(refreshExpiresAt) && refreshExpiresAt > 0 && refreshExpiresAt <= now) {
    return { verdict: 'refresh-expired', reason: 'stored refresh token has expired' };
  }
  const accessExpiresAt = Number(claudeAiOauth.expiresAt);
  if (!claudeAiOauth.accessToken || !Number.isFinite(accessExpiresAt) || accessExpiresAt <= now + ACCESS_TOKEN_SAFETY_MS) {
    return { verdict: 'need-refresh', reason: 'stored access token is expired or expiring soon' };
  }
  return { verdict: 'ok', reason: 'stored access token is still valid' };
}

// Local files cannot prove which account a token belongs to; the detectable
// poisoning case is live tokens that verbatim match a different stored slot.
function verifyLiveIdentity(config, credentials, store, getAccountKey) {
  if (!config || !config.oauthAccount) {
    return { ok: false, reason: 'The Claude config does not contain oauthAccount.' };
  }
  const oauth = credentials && credentials.claudeAiOauth;
  if (!oauth || !oauth.accessToken || !oauth.refreshToken) {
    return { ok: false, reason: 'The Claude credentials file has no usable claudeAiOauth tokens.' };
  }
  const liveKey = getAccountKey(config.oauthAccount);
  const accounts = Array.isArray(store && store.accounts) ? store.accounts : [];
  for (const entry of accounts) {
    if (!entry || entry.key === liveKey) continue;
    const stored = entry.credentials && entry.credentials.claudeAiOauth;
    if (!stored) continue;
    if ((stored.refreshToken && stored.refreshToken === oauth.refreshToken)
      || (stored.accessToken && stored.accessToken === oauth.accessToken)) {
      return {
        ok: false,
        reason: `Live credentials match the stored tokens of a different account (${entry.key}). Skipping sync to avoid corrupting the store.`,
      };
    }
  }
  return { ok: true };
}

module.exports = { assessCredentials, verifyLiveIdentity, ACCESS_TOKEN_SAFETY_MS };

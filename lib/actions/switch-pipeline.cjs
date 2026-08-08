function setSlot(store, key, mutate) {
  const index = store.accounts.findIndex((entry) => entry.key === key);
  if (index < 0) return null;
  mutate(store.accounts[index]);
  return store.accounts[index];
}

async function runSwitchPipeline(context) {
  const {
    selected,
    store,
    config,
    options,
    deepCopy,
    writeLiveState,
    verifyLiveState,
    writeStore,
    assessCredentials,
    refreshTokens,
    detectClaudeSessions,
    tokenCooldown,
    now,
    log,
    messages,
  } = context;

  const result = { switched: false, refreshed: false, abort: null, sessions: null };

  // A running session rewrites ~/.claude.json wholesale, which reverts the
  // oauthAccount swap and leaves the token/account pair mismatched.
  const sessions = detectClaudeSessions();
  result.sessions = sessions;
  if (sessions.detected && sessions.count > 0 && !options.force) {
    result.abort = { code: 'sessions-running', reason: `${sessions.count} Claude Code session(s) are running`, count: sessions.count };
    return result;
  }
  if (sessions.detected && sessions.count > 0 && options.force) {
    log(messages.getForcedSwitchWarning(sessions.count));
  }

  const assessment = assessCredentials(selected.credentials && selected.credentials.claudeAiOauth, now());
  if (assessment.verdict === 'refresh-expired') {
    setSlot(store, selected.key, (slot) => { slot.needsReauth = true; });
    writeStore(store, options);
    result.abort = { code: 'refresh-expired', reason: assessment.reason };
    return result;
  }

  const credentialsForLive = deepCopy(selected.credentials);
  if (assessment.verdict === 'need-refresh') {
    const cooldownUntil = tokenCooldown ? tokenCooldown.getUntil() : null;
    if (cooldownUntil) {
      result.abort = {
        code: 'rate-limited',
        reason: `the token endpoint is cooling down until ${new Date(cooldownUntil).toLocaleTimeString()}`,
      };
      return result;
    }

    log(messages.getRefreshProgress(selected.index));
    const refreshed = await refreshTokens(credentialsForLive.claudeAiOauth);
    if (!refreshed.ok) {
      if (refreshed.code === 'rate-limited' && tokenCooldown) tokenCooldown.start();
      if (refreshed.code === 'revoked') {
        // A rejected refresh token is dead for good: mark the slot so the next
        // run reports it instead of retrying a consumed token.
        setSlot(store, selected.key, (slot) => { slot.needsReauth = true; });
        writeStore(store, options);
      }
      result.abort = { code: refreshed.code, reason: refreshed.message };
      return result;
    }
    credentialsForLive.claudeAiOauth = refreshed.claudeAiOauth;
    result.refreshed = true;
    log(messages.getRefreshSuccess());
  }

  const nowIso = new Date().toISOString();
  setSlot(store, selected.key, (slot) => {
    slot.lastUsedAt = nowIso;
    delete slot.needsReauth;
    if (result.refreshed) {
      slot.credentials = deepCopy(credentialsForLive);
      slot.lastSyncedAt = nowIso;
    }
  });
  // Rotated refresh tokens are single-use: they must reach the store before
  // the live swap, or a failed live write would lose the only working copy.
  writeStore(store, options);

  const nextConfig = deepCopy(config);
  nextConfig.oauthAccount = deepCopy(selected.metadata);
  writeLiveState(nextConfig, credentialsForLive, options);

  const verified = verifyLiveState(options, {
    accountUuid: selected.metadata.accountUuid,
    accessToken: credentialsForLive.claudeAiOauth.accessToken,
  });
  if (!verified.ok) {
    result.abort = { code: 'verify-failed', reason: verified.reason };
    return result;
  }

  result.switched = true;
  return result;
}

module.exports = { runSwitchPipeline };

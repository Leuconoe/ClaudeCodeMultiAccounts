async function runSwitchPipeline(context) {
  const {
    selected,
    store,
    config,
    options,
    deepCopy,
    writeLiveState,
    writeStore,
    assessCredentials,
    refreshTokens,
    detectClaudeSessions,
    now,
    log,
    messages,
  } = context;

  const result = { switched: false, refreshed: false, abort: null };

  const sessions = detectClaudeSessions();
  if (sessions.detected && sessions.count > 0) {
    log(messages.getRunningSessionsWarning(sessions.count));
  }

  const assessment = assessCredentials(selected.credentials && selected.credentials.claudeAiOauth, now());
  if (assessment.verdict === 'refresh-expired') {
    result.abort = { code: 'refresh-expired', reason: assessment.reason };
    return result;
  }

  const credentialsForLive = deepCopy(selected.credentials);
  if (assessment.verdict === 'need-refresh') {
    log(messages.getRefreshProgress(selected.index));
    const refreshed = await refreshTokens(credentialsForLive.claudeAiOauth);
    if (!refreshed.ok) {
      result.abort = { code: refreshed.code, reason: refreshed.message };
      return result;
    }
    credentialsForLive.claudeAiOauth = refreshed.claudeAiOauth;
    result.refreshed = true;
    log(messages.getRefreshSuccess());
  }

  const nowIso = new Date().toISOString();
  const storeIndex = store.accounts.findIndex((entry) => entry.key === selected.key);
  if (storeIndex >= 0) {
    store.accounts[storeIndex].lastUsedAt = nowIso;
    if (result.refreshed) {
      store.accounts[storeIndex].credentials = deepCopy(credentialsForLive);
      store.accounts[storeIndex].lastSyncedAt = nowIso;
    }
  }
  // Rotated refresh tokens are single-use: they must reach the store before
  // the live swap, or a failed live write would lose the only working copy.
  writeStore(store, options);

  const nextConfig = deepCopy(config);
  nextConfig.oauthAccount = deepCopy(selected.metadata);
  writeLiveState(nextConfig, credentialsForLive, options);

  result.switched = true;
  return result;
}

module.exports = { runSwitchPipeline };

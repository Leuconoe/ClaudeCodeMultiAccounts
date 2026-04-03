async function runListAction(context) {
  const {
    synced,
    store,
    config,
    credentials,
    options,
    writeStore,
    getAccountKey,
    refreshStoredUsageSnapshots,
    fetchUsage,
    formatUsageInfo,
    formatAccountSummary,
    getDisplayAccounts,
    getListGuidance,
    getAvailableAccountsHeading,
    getRateLimitResetAt,
    setRateLimitResetAt,
    setRateLimitResetAtFromIso,
    ensureDir,
  } = context;

  if (synced.changed) {
    writeStore(store, options);
    console.log(`Saved the current account snapshot into ${context.path.basename(options.storePath)} before showing the account list.`);
  }

  const accessToken = credentials?.claudeAiOauth?.accessToken;
  if (accessToken) {
    try {
      const { currentUsage, changed } = await refreshStoredUsageSnapshots(
        store,
        getAccountKey(config.oauthAccount),
        (token) => fetchUsage(token, {
          setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir),
          setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir),
        })
      );
      if (changed) {
        writeStore(store, options);
      }
      if (options.showUsage && currentUsage) {
        console.log('--- Usage ---');
        for (const line of formatUsageInfo(currentUsage)) console.log(line);
        console.log('');
      }
    } catch {
      // Ignore usage refresh failures and render cached values.
    }
  }

  console.log(getAvailableAccountsHeading());
  for (const line of formatAccountSummary(getDisplayAccounts(store, config.oauthAccount))) {
    console.log(line);
  }
  console.log('');
  for (const line of getListGuidance(options.usageCommand)) console.log(line);
}

module.exports = { runListAction };

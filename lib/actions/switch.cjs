function runSwitchAction(context) {
  const {
    selected,
    store,
    config,
    options,
    deepCopy,
    writeLiveState,
    writeStore,
    getDisplayAccounts,
    inferPlanType,
    getPreferredDisplayName,
    getRestartNotice,
    getStoredAccountsHeading,
    formatAccountSummary,
    RESET_WINDOW_DAYS,
    getRateLimitResetAt,
  } = context;

  const now = new Date().toISOString();
  const storeIndex = store.accounts.findIndex((e) => e.key === selected.key);
  if (storeIndex >= 0) {
    store.accounts[storeIndex].lastUsedAt = now;
  }
  const nextConfig = deepCopy(config);
  const nextCredentials = deepCopy(selected.credentials);
  nextConfig.oauthAccount = deepCopy(selected.metadata);

  writeLiveState(nextConfig, nextCredentials, options);
  writeStore(store, options);

  const currentAccounts = getDisplayAccounts(store, selected.metadata);
  const currentPlan = inferPlanType(selected);
  console.log(`Switched active account to [${selected.index}] ${getPreferredDisplayName(selected.metadata)} <${selected.metadata.emailAddress}> (${currentPlan}).`);
  console.log('');
  console.log(getRestartNotice());
  console.log('');
  console.log(getStoredAccountsHeading());
  for (const line of formatAccountSummary(currentAccounts)) {
    console.log(line);
  }
}

module.exports = { runSwitchAction };

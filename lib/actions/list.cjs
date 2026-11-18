const { formatSessionInfo, getCurrentUsage, getUsageHeading } = require('../output/session.cjs');
const { getSessionStatus } = require('../auth/guard.cjs');

async function runListAction(context) {
  const {
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

  const currentKey = config.oauthAccount ? getAccountKey(config.oauthAccount) : null;
  let currentUsage = null;
  let currentError = null;
  try {
    const result = await refreshStoredUsageSnapshots(
      store,
      currentKey,
      (token) => fetchUsage(token, {
        setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir),
        setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir),
      })
    );
    ({ currentUsage, currentError } = result);
    if (result.changed) {
      writeStore(store, options);
    }
  } catch {
    // Ignore usage refresh failures and render cached values.
  }

  for (const line of formatSessionInfo({ store, config, credentials, currentError })) console.log(line);
  console.log('');
  const { usage, cached } = getCurrentUsage(store, currentKey, currentUsage);
  if (options.showUsage) {
    console.log(getUsageHeading(usage, cached));
    if (usage) {
      for (const line of formatUsageInfo(usage)) console.log(line);
    } else {
      console.log('No usage data available for the current account.');
    }
    console.log('');
  }

  console.log(getAvailableAccountsHeading());
  const accounts = getDisplayAccounts(store, config.oauthAccount).map((entry) => entry.current ? {
    ...entry,
    sessionStatus: getSessionStatus(credentials?.claudeAiOauth, entry.needsReauth, currentError?.statusCode === 401),
  } : entry);
  for (const line of formatAccountSummary(accounts)) {
    console.log(line);
  }
  console.log('');
  for (const line of getListGuidance()) console.log(line);
}

module.exports = { runListAction };

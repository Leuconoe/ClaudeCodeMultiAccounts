const { formatSessionInfo, getCurrentUsage, getUsageHeading } = require('../output/session.cjs');

async function runUsageAction(context) {
  const { store, config, credentials, fetchUsage, formatUsageInfo, setRateLimitResetAt, setRateLimitResetAtFromIso, ensureDir, refreshStoredUsageSnapshots, writeStore, options, getAccountKey } = context;
  const currentKey = config.oauthAccount ? getAccountKey(config.oauthAccount) : null;
  console.log('Fetching usage from Claude API...');
  const { currentUsage, currentError, changed } = await refreshStoredUsageSnapshots(
    store,
    currentKey,
    (token) => fetchUsage(token, {
      setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir),
      setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir),
    })
  );
  if (changed) {
    writeStore(store, options);
  }
  for (const line of formatSessionInfo({ store, config, credentials, currentError })) console.log(line);
  console.log('');
  const { usage, cached } = getCurrentUsage(store, currentKey, currentUsage);
  console.log(getUsageHeading(usage, cached));
  if (usage) {
    for (const line of formatUsageInfo(usage)) console.log(line);
  } else {
    console.log('No usage data available for the current account.');
  }
}

module.exports = { runUsageAction };

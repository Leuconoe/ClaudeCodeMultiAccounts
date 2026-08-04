const { runSwitchPipeline } = require('./switch-pipeline.cjs');

async function runSwitchAction(context) {
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
    messages,
    stageSwitch,
    getDisplayAccounts,
    inferPlanType,
    getEntryLabel,
    getRestartNotice,
    getStoredAccountsHeading,
    formatAccountSummary,
    fromStaged,
  } = context;

  const result = await runSwitchPipeline({
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
    log: (line) => console.log(line),
    messages,
  });

  const label = getEntryLabel(selected);

  if (result.abort && result.abort.code === 'sessions-running') {
    // Staging keeps the intent without touching live files, which a running
    // session would revert anyway.
    const staged = fromStaged ? null : stageSwitch(selected);
    for (const line of messages.getSessionsBlockedLines(result.abort.count, label, selected.index, options.usageCommand, staged)) {
      console.log(line);
    }
    process.exitCode = 1;
    return result;
  }

  if (!result.switched) {
    for (const line of messages.getSwitchAbortedLines(result.abort, label, options.usageCommand)) {
      console.log(line);
    }
    process.exitCode = 1;
    return result;
  }

  const currentAccounts = getDisplayAccounts(store, selected.metadata);
  const currentPlan = inferPlanType(selected);
  console.log(`Switched active account to [${selected.index}] ${label} <${selected.metadata.emailAddress}> (${currentPlan}).`);
  console.log('');
  console.log(getRestartNotice());
  console.log('');
  console.log(getStoredAccountsHeading());
  for (const line of formatAccountSummary(currentAccounts)) {
    console.log(line);
  }
  return result;
}

module.exports = { runSwitchAction };

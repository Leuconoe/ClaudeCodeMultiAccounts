const { runSwitchPipeline } = require('./switch-pipeline.cjs');

async function runSwitchAction(context) {
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
    messages,
    getDisplayAccounts,
    inferPlanType,
    getEntryLabel,
    getRestartNotice,
    getStoredAccountsHeading,
    formatAccountSummary,
  } = context;

  const result = await runSwitchPipeline({
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
    log: (line) => console.log(line),
    messages,
  });

  if (!result.switched) {
    for (const line of messages.getSwitchAbortedLines(result.abort, getEntryLabel(selected), options.usageCommand)) {
      console.log(line);
    }
    process.exitCode = 1;
    return result;
  }

  const currentAccounts = getDisplayAccounts(store, selected.metadata);
  const currentPlan = inferPlanType(selected);
  console.log(`Switched active account to [${selected.index}] ${getEntryLabel(selected)} <${selected.metadata.emailAddress}> (${currentPlan}).`);
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

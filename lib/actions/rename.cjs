function runRenameAction(existingStore, renameIndex, alias, deps) {
  const {
    writeStore,
    options,
    config,
    getEntryLabel,
    getDisplayAccounts,
    getStoredAccountsHeading,
    formatAccountSummary,
  } = deps;

  if (typeof renameIndex !== 'number' || renameIndex < 0 || renameIndex >= existingStore.accounts.length) {
    throw new Error(`Invalid account index. Use an index between 0 and ${existingStore.accounts.length - 1}.`);
  }

  const trimmed = String(alias || '').trim();
  const entry = existingStore.accounts[renameIndex];
  if (trimmed) {
    entry.alias = trimmed;
  } else {
    delete entry.alias;
  }
  writeStore(existingStore, options);

  const email = (entry.metadata && entry.metadata.emailAddress) || '(no email)';
  if (trimmed) {
    console.log(`Renamed account: [${renameIndex}] ${trimmed} <${email}>`);
  } else {
    console.log(`Cleared alias: [${renameIndex}] ${getEntryLabel(entry)} <${email}>`);
  }
  console.log('');
  console.log(getStoredAccountsHeading());
  const currentMetadata = config && config.oauthAccount ? config.oauthAccount : null;
  for (const line of formatAccountSummary(getDisplayAccounts(existingStore, currentMetadata))) {
    console.log(line);
  }
}

module.exports = { runRenameAction };

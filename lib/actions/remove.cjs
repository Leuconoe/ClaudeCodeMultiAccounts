function runRemoveAction(existingStore, removeIndex, deps) {
  const { removeStoredAccount, writeStore, options, getEntryLabel, getRemainingAccountsHeading } = deps;
  const removed = removeStoredAccount(existingStore, removeIndex);
  writeStore(existingStore, options);
  const name = getEntryLabel(removed);
  const email = (removed.metadata && removed.metadata.emailAddress) || '(no email)';
  console.log(`Removed account: [${removeIndex}] ${name} <${email}>`);
  console.log('');
  console.log(getRemainingAccountsHeading());
  for (const entry of existingStore.accounts) {
    const m = entry.metadata || {};
    console.log(`  [${entry.index}] ${getEntryLabel(entry)} <${m.emailAddress || '(no email)'}>`);
  }
}

module.exports = { runRemoveAction };

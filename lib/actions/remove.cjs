function runRemoveAction(existingStore, removeIndex, deps) {
  const { removeStoredAccount, writeStore, options, getPreferredDisplayName, getRemainingAccountsHeading } = deps;
  const removed = removeStoredAccount(existingStore, removeIndex);
  writeStore(existingStore, options);
  const name = getPreferredDisplayName(removed.metadata || {});
  const email = (removed.metadata && removed.metadata.emailAddress) || '(no email)';
  console.log(`Removed account: [${removeIndex}] ${name} <${email}>`);
  console.log('');
  console.log(getRemainingAccountsHeading());
  for (const entry of existingStore.accounts) {
    const m = entry.metadata || {};
    console.log(`  [${entry.index}] ${getPreferredDisplayName(m)} <${m.emailAddress || '(no email)'}>`);
  }
}

module.exports = { runRemoveAction };

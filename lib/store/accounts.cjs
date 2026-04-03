function getAccountKey(account) {
  if (account?.accountUuid && String(account.accountUuid).trim()) {
    return `uuid:${String(account.accountUuid).trim().toLowerCase()}`;
  }
  if (account?.emailAddress && String(account.emailAddress).trim()) {
    return `email:${String(account.emailAddress).trim().toLowerCase()}`;
  }
  throw new Error('Account entry is missing both accountUuid and emailAddress.');
}

function normalizeStore(store, storeVersion) {
  const normalized = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(normalized.accounts)) {
    normalized.accounts = [];
  }
  normalized.version = storeVersion;
  return normalized;
}

function getDisplayAccounts(store, currentMetadata) {
  const currentKey = currentMetadata ? getAccountKey(currentMetadata) : null;
  return store.accounts.map((entry, index) => ({
    ...entry,
    index,
    current: currentKey && getAccountKey(entry.metadata) === currentKey,
  }));
}

function syncStoreFromLive(store, config, credentials, deepCopy, storeVersion) {
  if (!config?.oauthAccount) {
    throw new Error('The Claude config does not contain oauthAccount.');
  }
  if (!credentials?.claudeAiOauth) {
    throw new Error('The Claude credentials file does not contain claudeAiOauth.');
  }

  const key = getAccountKey(config.oauthAccount);
  const now = new Date().toISOString();
  const existingEntry = store.accounts?.find((e) => e.key === key);
  const snapshot = {
    key,
    metadata: deepCopy(config.oauthAccount),
    credentials: deepCopy(credentials),
    capturedAt: now,
    lastSyncedAt: now,
    lastUsedAt: existingEntry?.lastUsedAt || undefined,
    usageSnapshot: existingEntry?.usageSnapshot || undefined,
  };

  const nextStore = normalizeStore(deepCopy(store), storeVersion);
  const existingIndex = nextStore.accounts.findIndex((entry) => entry.key === key);
  if (existingIndex >= 0) {
    nextStore.accounts[existingIndex] = snapshot;
  } else {
    nextStore.accounts.push(snapshot);
  }

  nextStore.updatedAt = new Date().toISOString();

  return {
    changed: JSON.stringify(store) !== JSON.stringify(nextStore),
    store: nextStore,
    key,
  };
}

function findSelection(accounts, selector) {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error('Selector cannot be empty.');
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && String(numeric) === trimmed) {
    const byIndex = accounts.find((entry) => Number(entry.index) === numeric);
    if (byIndex) return byIndex;
  }

  throw new Error(`No account matched index '${trimmed}'. Use a numeric index.`);
}

function removeStoredAccount(store, removeIndex) {
  if (typeof removeIndex !== 'number' || removeIndex < 0 || removeIndex >= store.accounts.length) {
    throw new Error(`Invalid account index. Use an index between 0 and ${store.accounts.length - 1}.`);
  }
  const removed = store.accounts.splice(removeIndex, 1)[0];
  store.accounts.forEach((entry, i) => {
    entry.index = i;
  });
  return removed;
}

module.exports = {
  getAccountKey,
  normalizeStore,
  getDisplayAccounts,
  syncStoreFromLive,
  findSelection,
  removeStoredAccount,
};

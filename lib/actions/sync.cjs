function runSyncAction(existingStore, config, credentials, deps) {
  const { syncStoreFromLive, deepCopy, storeVersion, writeStore, options, path } = deps;
  const result = syncStoreFromLive(existingStore, config, credentials, deepCopy, storeVersion);
  if (result.changed) {
    writeStore(result.store, options);
    console.log(`Synced current account into ${path.basename(options.storePath)}.`);
  } else {
    console.log(`${path.basename(options.storePath)} already matches the current account snapshot.`);
  }
}

module.exports = { runSyncAction };

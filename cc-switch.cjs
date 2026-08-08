#!/usr/bin/env node

const path = require('path');
const storeIo = require('./lib/store/io.cjs');
const storeAccounts = require('./lib/store/accounts.cjs');
const usageCache = require('./lib/usage/cache.cjs');
const usageFetch = require('./lib/usage/fetch.cjs');
const usageFormat = require('./lib/usage/format.cjs');
const outputAccounts = require('./lib/output/accounts.cjs');
const outputUsage = require('./lib/output/usage.cjs');
const outputMessages = require('./lib/output/messages.cjs');
const syncAction = require('./lib/actions/sync.cjs');
const usageAction = require('./lib/actions/usage.cjs');
const removeAction = require('./lib/actions/remove.cjs');
const listAction = require('./lib/actions/list.cjs');
const switchAction = require('./lib/actions/switch.cjs');
const renameAction = require('./lib/actions/rename.cjs');
const authGuard = require('./lib/auth/guard.cjs');
const authRefresh = require('./lib/auth/refresh.cjs');
const procSessions = require('./lib/proc/sessions.cjs');
const storeLock = require('./lib/store/lock.cjs');
const stagedSwitch = require('./lib/actions/staged.cjs');
const switchWatcher = require('./lib/actions/watcher.cjs');

const {
  getDefaultConfigPath,
  getDefaultCredentialsPath,
  getDefaultStorePath,
  getDefaultBackupDir,
  ensureDir,
  readJson,
  readJsonIfExists,
  deepCopy,
  writeLiveState,
  verifyLiveState,
  writeStore,
} = storeIo;

const {
  getAccountKey,
  normalizeStore,
  getDisplayAccounts,
  syncStoreFromLive,
  findSelection,
  removeStoredAccount,
} = storeAccounts;

const {
  readSettings,
  writeSettings,
  getRateLimitResetAt,
  setRateLimitResetAt,
  setRateLimitResetAtFromIso,
} = usageCache;

const fetchUsageApi = usageFetch.fetchUsage;
const formatUsageInfoUi = usageFormat.formatUsageInfo;
const refreshStoredUsageSnapshotsUi = usageFormat.refreshStoredUsageSnapshots;
const getUsageColumnsUi = outputUsage.getUsageColumns;

const getEntryLabelUi = outputAccounts.getEntryLabel;
const inferPlanTypeUi = outputAccounts.inferPlanType;
const formatAccountSummaryUi = outputAccounts.formatAccountSummary;

const formatRelativeTimeUi = outputUsage.formatRelativeTime;

const getListGuidance = outputMessages.getListGuidance;
const getRestartNotice = outputMessages.getRestartNotice;
const getAvailableAccountsHeading = outputMessages.getAvailableAccountsHeading;
const getStoredAccountsHeading = outputMessages.getStoredAccountsHeading;
const getRemainingAccountsHeading = outputMessages.getRemainingAccountsHeading;

const runSyncAction = syncAction.runSyncAction;
const runUsageAction = usageAction.runUsageAction;
const runRemoveAction = removeAction.runRemoveAction;
const runListAction = listAction.runListAction;
const runSwitchAction = switchAction.runSwitchAction;
const runRenameAction = renameAction.runRenameAction;

const STORE_VERSION = '0.2.9';
const RESET_WINDOW_DAYS = 7;

function parseArgs(argv) {
  const settings = readSettings();
  const options = {
    usageCommand: '/switch',
    configPath: getDefaultConfigPath(),
    credentialsPath: getDefaultCredentialsPath(),
    storePath: getDefaultStorePath(),
    backupDir: getDefaultBackupDir(),
    syncOnly: false,
    touchCurrentOnly: false,
    usageOnly: false,
    removeOnly: false,
    removeIndex: null,
    renameOnly: false,
    renameIndex: null,
    renameAliasParts: [],
    showUsage: settings.showUsage !== false,
    force: false,
    cancelOnly: false,
    watchApply: false,
    noWatch: false,
    selector: '',
  };

  const args = [...argv];
  while (args.length > 0) {
    const current = args.shift();
    if (current === '--usage-command') {
      options.usageCommand = args.shift() || options.usageCommand;
      continue;
    }
    if (current === '--config') {
      options.configPath = args.shift() || options.configPath;
      continue;
    }
    if (current === '--credentials') {
      options.credentialsPath = args.shift() || options.credentialsPath;
      continue;
    }
    if (current === '--store') {
      options.storePath = args.shift() || options.storePath;
      continue;
    }
    if (current === '--backup-dir') {
      options.backupDir = args.shift() || options.backupDir;
      continue;
    }
    if (current === '--sync' || current === 'sync') {
      options.syncOnly = true;
      continue;
    }
    if (current === '--force' || current === '-f') {
      options.force = true;
      continue;
    }
    if (current === '--cancel' || current === 'cancel') {
      options.cancelOnly = true;
      continue;
    }
    if (current === '--watch-apply') {
      options.watchApply = true;
      continue;
    }
    if (current === '--no-watch') {
      options.noWatch = true;
      continue;
    }
    if (current === '--touch-current') {
      options.touchCurrentOnly = true;
      continue;
    }
    if (current === '--usage' || current === 'usage') {
      options.usageOnly = true;
      continue;
    }
    if (current === '--remove' || current === 'remove') {
      options.removeOnly = true;
      continue;
    }
    if (current === '--rename' || current === 'rename') {
      options.renameOnly = true;
      continue;
    }
    if (current === '--show-usage') {
      options.showUsage = true;
      const s = readSettings();
      s.showUsage = true;
      writeSettings(s, ensureDir);
      console.log('Usage display enabled.');
      return options;
    }
    if (current === '--hide-usage') {
      options.showUsage = false;
      const s = readSettings();
      s.showUsage = false;
      writeSettings(s, ensureDir);
      console.log('Usage display disabled.');
      return options;
    }
    if (options.removeOnly && options.removeIndex === null) {
      const numeric = Number.parseInt(current, 10);
      if (!Number.isNaN(numeric) && String(numeric) === current) {
        options.removeIndex = numeric;
        continue;
      }
    }
    if (options.renameOnly) {
      if (options.renameIndex === null) {
        const numeric = Number.parseInt(current, 10);
        if (!Number.isNaN(numeric) && String(numeric) === current) {
          options.renameIndex = numeric;
          continue;
        }
      }
      options.renameAliasParts.push(current);
      continue;
    }
    if (!options.selector) {
      options.selector = current;
      continue;
    }
  }

  return options;
}

function buildSwitchContext(extra) {
  return {
    deepCopy,
    writeLiveState,
    verifyLiveState,
    writeStore,
    assessCredentials: authGuard.assessCredentials,
    refreshTokens: authRefresh.refreshTokens,
    detectClaudeSessions: procSessions.detectClaudeSessions,
    tokenCooldown: {
      getUntil: () => usageCache.getTokenCooldownUntil(),
      start: () => usageCache.setTokenCooldown(ensureDir),
    },
    now: () => Date.now(),
    messages: outputMessages,
    stageSwitch: (selected) => {
      const staged = stagedSwitch.stageSwitch(selected, {
        readSettings,
        writeSettings,
        ensureDir,
        now: () => Date.now(),
      });
      if (!extra.options.noWatch) {
        staged.watcher = switchWatcher.spawnWatcher({
          cliPath: __filename,
          options: extra.options,
          readSettings,
          writeSettings,
          ensureDir,
        });
      }
      return staged;
    },
    getDisplayAccounts,
    inferPlanType: inferPlanTypeUi,
    getEntryLabel: getEntryLabelUi,
    getRestartNotice,
    getStoredAccountsHeading,
    formatAccountSummary: (items) => formatAccountSummaryUi(items, {
      formatRelativeTime: formatRelativeTimeUi,
      getUsageColumns: (entry) => getUsageColumnsUi(entry, getRateLimitResetAt, RESET_WINDOW_DAYS),
    }),
    ...extra,
  };
}

// Warns about slots that can no longer be restored without an interactive
// login: a rejected refresh token, or a hard expiry closing in.
function reportSlotHealth(accounts, options) {
  const now = Date.now();
  for (const entry of accounts) {
    const label = getEntryLabelUi(entry);
    if (entry.needsReauth) {
      console.log(outputMessages.getNeedsReauthNotice(label, options.usageCommand));
      continue;
    }
    const status = authGuard.getRefreshExpiryStatus(entry.credentials && entry.credentials.claudeAiOauth, now);
    if (status.warn) {
      console.log(outputMessages.getRefreshExpiryWarning(label, status.daysLeft));
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.cancelOnly) {
    const cancelled = stagedSwitch.clearStagedSwitch({ readSettings, writeSettings, ensureDir });
    // The watcher notices the cleared record on its next tick and exits.
    console.log(cancelled
      ? outputMessages.getStagedCancelledNotice(cancelled)
      : outputMessages.getStagedMissingNotice());
    return;
  }

  if (options.watchApply) {
    await runWatcher(options);
    return;
  }

  try {
    // Everything below reads-then-writes the credential files, so the lock is
    // taken before the first read: another process (or a concurrent hook) may
    // have rotated a single-use refresh token since we last looked.
    await storeLock.withLock({}, async () => { await run(options); });
  } catch (error) {
    console.log(`Switch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

// Runs detached after a staged switch: waits for the last Claude Code session
// to exit, then applies the switch so the next launch is on the new account.
async function runWatcher(options) {
  const applyOptions = { ...options, watchApply: false, selector: '', showUsage: false };
  const result = await switchWatcher.runWatchLoop({
    detectClaudeSessions: procSessions.detectClaudeSessions,
    readStaged: () => stagedSwitch.readStagedSwitch(readSettings()),
    applyNow: async () => {
      try {
        await storeLock.withLock({}, async () => { await run(applyOptions); });
      } catch {
        return false;
      }
      // run() clears the staged record only after a verified switch.
      return !stagedSwitch.readStagedSwitch(readSettings());
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  });
  switchWatcher.clearWatcherRecord({ readSettings, writeSettings, ensureDir });
  console.log(`Watcher finished: ${result.outcome}`);
  return result;
}

async function run(options) {
  {
    const config = readJson(options.configPath);
    const credentials = readJson(options.credentialsPath);
    const existingStore = normalizeStore(readJsonIfExists(options.storePath, { version: STORE_VERSION, accounts: [] }), STORE_VERSION);

    if (options.usageOnly) {
      const syncedForUsage = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
      if (syncedForUsage.warning) {
        console.log(outputMessages.getSyncSkippedWarning(syncedForUsage.warning));
      }
      await runUsageAction({
        store: syncedForUsage.store,
        config,
        credentials,
        fetchUsage: fetchUsageApi,
        formatUsageInfo: formatUsageInfoUi,
        refreshStoredUsageSnapshots: refreshStoredUsageSnapshotsUi,
        writeStore,
        options,
        getAccountKey,
        setRateLimitResetAt,
        setRateLimitResetAtFromIso,
        ensureDir,
      });
      return;
    }

    if (options.syncOnly) {
      runSyncAction(existingStore, config, credentials, {
        syncStoreFromLive,
        deepCopy,
        storeVersion: STORE_VERSION,
        writeStore,
        options,
        path,
      });
      return;
    }

    if (options.touchCurrentOnly) {
      const syncedTouch = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
      const storeTouch = syncedTouch.store;
      const currentKey = getAccountKey(config.oauthAccount);
      const idx = storeTouch.accounts.findIndex((e) => e.key === currentKey);
      if (idx >= 0) {
        storeTouch.accounts[idx].lastUsedAt = new Date().toISOString();
      }
      writeStore(storeTouch, options);
      return;
    }

    if (options.removeOnly) {
      runRemoveAction(existingStore, options.removeIndex, {
        removeStoredAccount,
        writeStore,
        options,
        getEntryLabel: getEntryLabelUi,
        getRemainingAccountsHeading,
      });
      return;
    }

    if (options.renameOnly) {
      runRenameAction(existingStore, options.renameIndex, options.renameAliasParts.join(' '), {
        writeStore,
        options,
        config,
        getEntryLabel: getEntryLabelUi,
        getDisplayAccounts,
        getStoredAccountsHeading,
        formatAccountSummary: (items) => formatAccountSummaryUi(items, {
          formatRelativeTime: formatRelativeTimeUi,
          getUsageColumns: (entry) => getUsageColumnsUi(entry, getRateLimitResetAt, RESET_WINDOW_DAYS),
        }),
      });
      return;
    }

    const synced = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
    if (synced.warning) {
      console.log(outputMessages.getSyncSkippedWarning(synced.warning));
    }
    const store = synced.store;
    const accounts = getDisplayAccounts(store, config.oauthAccount);

    // A bare invocation is the moment to apply a switch staged earlier from
    // inside a Claude Code session that could not safely apply it.
    if (!options.selector) {
      const staged = stagedSwitch.readStagedSwitch(readSettings());
      if (staged) {
        const stagedSelection = stagedSwitch.resolveStagedSelection(staged, accounts);
        if (!stagedSelection) {
          console.log(outputMessages.getStagedStaleNotice(staged));
          stagedSwitch.clearStagedSwitch({ readSettings, writeSettings, ensureDir });
        } else {
          console.log(outputMessages.getStagedApplyingNotice(getEntryLabelUi(stagedSelection), stagedSelection.index));
          const stagedResult = await runSwitchAction(buildSwitchContext({
            selected: stagedSelection,
            store,
            config,
            options,
            fromStaged: true,
          }));
          if (stagedResult.switched) {
            stagedSwitch.clearStagedSwitch({ readSettings, writeSettings, ensureDir });
          }
          return;
        }
      }
    }

    if (!options.selector) {
      reportSlotHealth(accounts, options);
      await runListAction({
        synced,
        store,
        config,
        credentials,
        options,
        writeStore,
        getAccountKey,
        refreshStoredUsageSnapshots: refreshStoredUsageSnapshotsUi,
        fetchUsage: fetchUsageApi,
        formatUsageInfo: formatUsageInfoUi,
        formatAccountSummary: (items) => formatAccountSummaryUi(items, {
          formatRelativeTime: formatRelativeTimeUi,
          getUsageColumns: (entry) => getUsageColumnsUi(entry, getRateLimitResetAt, RESET_WINDOW_DAYS),
        }),
        getDisplayAccounts,
        getListGuidance,
        getAvailableAccountsHeading,
        getRateLimitResetAt,
        setRateLimitResetAt,
        setRateLimitResetAtFromIso,
        ensureDir,
        RESET_WINDOW_DAYS,
        path,
      });
      return;
    }

    const selected = findSelection(accounts, options.selector);
    await runSwitchAction(buildSwitchContext({ selected, store, config, options }));
  }
}

main();

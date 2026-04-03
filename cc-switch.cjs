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
const getUsageColumnsUi = usageFormat.getUsageColumns;

const getPreferredDisplayNameUi = outputAccounts.getPreferredDisplayName;
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
    usageOnly: false,
    removeOnly: false,
    removeIndex: null,
    showUsage: settings.showUsage !== false,
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
    if (current === '--usage' || current === 'usage') {
      options.usageOnly = true;
      continue;
    }
    if (current === '--remove' || current === 'remove') {
      options.removeOnly = true;
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
    if (!options.selector) {
      options.selector = current;
      continue;
    }
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const config = readJson(options.configPath);
    const credentials = readJson(options.credentialsPath);
    const existingStore = normalizeStore(readJsonIfExists(options.storePath, { version: STORE_VERSION, accounts: [] }), STORE_VERSION);

    if (options.usageOnly) {
      await runUsageAction({
        credentials,
        fetchUsage: fetchUsageApi,
        formatUsageInfo: formatUsageInfoUi,
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

    if (options.removeOnly) {
      runRemoveAction(existingStore, options.removeIndex, {
        removeStoredAccount,
        writeStore,
        options,
        getPreferredDisplayName: getPreferredDisplayNameUi,
        getRemainingAccountsHeading,
      });
      return;
    }

    const synced = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
    const store = synced.store;
    const accounts = getDisplayAccounts(store, config.oauthAccount);

    if (!options.selector) {
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
    runSwitchAction({
      selected,
      store,
      config,
      options,
      deepCopy,
      writeLiveState,
      writeStore,
      getDisplayAccounts,
      inferPlanType: inferPlanTypeUi,
      getPreferredDisplayName: getPreferredDisplayNameUi,
      getRestartNotice,
      getStoredAccountsHeading,
      formatAccountSummary: (items) => formatAccountSummaryUi(items, {
        formatRelativeTime: formatRelativeTimeUi,
        getUsageColumns: (entry) => getUsageColumnsUi(entry, getRateLimitResetAt, RESET_WINDOW_DAYS),
      }),
      RESET_WINDOW_DAYS,
      getRateLimitResetAt,
    });
  } catch (error) {
    console.log(`Switch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();

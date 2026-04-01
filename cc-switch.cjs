#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const STORE_VERSION = '0.2.1';
const RESET_WINDOW_DAYS = 7;

function getDefaultConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

function getDefaultCredentialsPath() {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

function getDefaultStorePath() {
  return path.join(os.homedir(), '.ClaudeCodeMultiAccounts.json');
}

function getDefaultBackupDir() {
  return path.join(os.homedir(), '.claude', 'backups', 'multi-account-switch');
}

function parseArgs(argv) {
  const options = {
    usageCommand: '/switch',
    configPath: getDefaultConfigPath(),
    credentialsPath: getDefaultCredentialsPath(),
    storePath: getDefaultStorePath(),
    backupDir: getDefaultBackupDir(),
    syncOnly: false,
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
    if (!options.selector) {
      options.selector = current;
      continue;
    }
  }

  return options;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return readJson(filePath);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function backupFile(filePath, backupDir) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  fs.copyFileSync(filePath, path.join(backupDir, `${path.basename(filePath)}.${timestamp}.bak`));
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAccountKey(account) {
  if (account?.accountUuid && String(account.accountUuid).trim()) {
    return `uuid:${String(account.accountUuid).trim().toLowerCase()}`;
  }
  if (account?.emailAddress && String(account.emailAddress).trim()) {
    return `email:${String(account.emailAddress).trim().toLowerCase()}`;
  }
  throw new Error('Account entry is missing both accountUuid and emailAddress.');
}

function isSuspiciousDisplayName(value) {
  return value.includes('\uFFFD') || (value.match(/\?/g) || []).length >= 2;
}

function getPreferredDisplayName(metadata) {
  if (metadata?.displayName && String(metadata.displayName).trim()) {
    const displayName = String(metadata.displayName).trim();
    if (!isSuspiciousDisplayName(displayName)) {
      return displayName;
    }
  }

  if (metadata?.emailAddress && String(metadata.emailAddress).trim()) {
    const email = String(metadata.emailAddress).trim();
    const atIndex = email.indexOf('@');
    return atIndex > 0 ? email.slice(0, atIndex) : email;
  }

  return '(no display name)';
}

function inferPlanType(entry) {
  const metadata = entry.metadata || {};
  const credential = entry.credentials?.claudeAiOauth || {};
  const subscriptionType = credential.subscriptionType;

  if (subscriptionType === 'team') {
    return 'Teams';
  }
  if (subscriptionType === 'enterprise') {
    return 'Enterprise';
  }

  const hasOrgScope = Boolean(metadata.organizationRole) || Boolean(metadata.workspaceRole);
  if (hasOrgScope) {
    return metadata.billingType === 'stripe_subscription' ? 'Teams' : 'Enterprise';
  }
  if (metadata.hasExtraUsageEnabled === true) {
    return 'Max';
  }
  if (metadata.billingType === 'stripe_subscription') {
    return 'Pro';
  }
  return 'Unknown';
}

function normalizeStore(store) {
  const normalized = store && typeof store === 'object' ? store : {};
  if (!Array.isArray(normalized.accounts)) {
    normalized.accounts = [];
  }
  normalized.version = STORE_VERSION;
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

function syncStoreFromLive(store, config, credentials) {
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
  };

  const nextStore = normalizeStore(deepCopy(store));
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

  const normalized = trimmed.toLowerCase();
  for (const entry of accounts) {
    for (const candidate of [entry.key, entry.metadata?.accountUuid, entry.metadata?.emailAddress, entry.metadata?.displayName]) {
      if (candidate && String(candidate).trim().toLowerCase() === normalized) {
        return entry;
      }
    }
  }

  throw new Error(`No account matched selector '${selector}'.`);
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatResetEstimate(isoString) {
  if (!isoString) return 'unknown';
  const resetDate = new Date(new Date(isoString).getTime() + RESET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const diff = resetDate.getTime() - now.getTime();
  if (diff <= 0) return 'reset now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `~${days}d ${remainingHours}h`;
}

function formatRelativeTime(isoString) {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatResetEstimate(isoString) {
  if (!isoString) return 'unknown';
  const resetDate = new Date(new Date(isoString).getTime() + RESET_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  const diff = resetDate.getTime() - now.getTime();
  if (diff <= 0) return 'reset now';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `~${days}d ${remainingHours}h`;
}

function formatAccountSummary(accounts) {
  return accounts.map((entry) => {
    const marker = entry.current ? '*' : ' ';
    const metadata = entry.metadata || {};
    const displayName = getPreferredDisplayName(metadata);
    const email = metadata.emailAddress && String(metadata.emailAddress).trim() ? metadata.emailAddress : '(no email)';
    const org = metadata.organizationName && String(metadata.organizationName).trim() ? metadata.organizationName : '(no organization)';
    const plan = inferPlanType(entry);
    const lastSynced = formatRelativeTime(entry.lastSyncedAt);
    const lastUsed = formatRelativeTime(entry.lastUsedAt);
    const resetEst = formatResetEstimate(entry.lastSyncedAt);
    return `${marker} [${entry.index}] ${displayName} <${email}> - ${org} - ${plan} | synced: ${lastSynced} | used: ${lastUsed} | reset: ${resetEst}`;
  });
}

function writeLiveState(config, credentials, options) {
  backupFile(options.configPath, options.backupDir);
  backupFile(options.credentialsPath, options.backupDir);
  writeJson(options.configPath, config);
  writeJson(options.credentialsPath, credentials);
}

function writeStore(store, options) {
  backupFile(options.storePath, options.backupDir);
  writeJson(options.storePath, store);
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const config = readJson(options.configPath);
    const credentials = readJson(options.credentialsPath);
    const existingStore = normalizeStore(readJsonIfExists(options.storePath, { version: STORE_VERSION, accounts: [] }));

    if (options.syncOnly) {
      const result = syncStoreFromLive(existingStore, config, credentials);
      if (result.changed) {
        writeStore(result.store, options);
        console.log(`Synced current account into ${path.basename(options.storePath)}.`);
      } else {
        console.log(`${path.basename(options.storePath)} already matches the current account snapshot.`);
      }
      return;
    }

    const synced = syncStoreFromLive(existingStore, config, credentials);
    const store = synced.store;
    const accounts = getDisplayAccounts(store, config.oauthAccount);

    if (!options.selector) {
      if (synced.changed) {
        writeStore(store, options);
        console.log(`Saved the current account snapshot into ${path.basename(options.storePath)} before showing the account list.`);
      }
      console.log('Available Claude accounts:');
      for (const line of formatAccountSummary(accounts)) {
        console.log(line);
      }
      console.log('');
      console.log(`Run ${options.usageCommand} <index|email|accountUuid> to make one of these stored entries the active Claude account.`);
      return;
    }

    const selected = findSelection(accounts, options.selector);
    const now = new Date().toISOString();
    const storeIndex = store.accounts.findIndex((e) => e.key === selected.key);
    if (storeIndex >= 0) {
      store.accounts[storeIndex].lastUsedAt = now;
    }
    const nextConfig = deepCopy(config);
    const nextCredentials = deepCopy(selected.credentials);
    nextConfig.oauthAccount = deepCopy(selected.metadata);

    writeLiveState(nextConfig, nextCredentials, options);
    writeStore(store, options);
    writeStore(store, options);

    const currentAccounts = getDisplayAccounts(store, selected.metadata);
    const currentPlan = inferPlanType(selected);
    console.log(`Switched active account to [${selected.index}] ${getPreferredDisplayName(selected.metadata)} <${selected.metadata.emailAddress}> (${currentPlan}).`);
    console.log('');
    console.log('Stored account list:');
    for (const line of formatAccountSummary(currentAccounts)) {
      console.log(line);
    }
  } catch (error) {
    console.log(`Switch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();

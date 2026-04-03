#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const storeIo = require('./lib/store/io.cjs');
const storeAccounts = require('./lib/store/accounts.cjs');
const usageCache = require('./lib/usage/cache.cjs');
const usageFetch = require('./lib/usage/fetch.cjs');
const usageFormat = require('./lib/usage/format.cjs');
const outputAccounts = require('./lib/output/accounts.cjs');
const outputUsage = require('./lib/output/usage.cjs');
const outputMessages = require('./lib/output/messages.cjs');

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
  getSettingsPath,
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

const STORE_VERSION = '0.2.2';
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
      writeSettings(s);
      console.log('Usage display enabled.');
      return options;
    }
    if (current === '--hide-usage') {
      options.showUsage = false;
      const s = readSettings();
      s.showUsage = false;
      writeSettings(s);
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

  if (subscriptionType === 'team') return 'Teams';
  if (subscriptionType === 'enterprise') return 'Enterprise';

  const hasOrgScope = Boolean(metadata.organizationRole) || Boolean(metadata.workspaceRole);
  if (hasOrgScope) return metadata.billingType === 'stripe_subscription' ? 'Teams' : 'Enterprise';
  if (metadata.hasExtraUsageEnabled === true) return 'Max';
  if (metadata.billingType === 'stripe_subscription') return 'Pro';
  return 'Unknown';
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
  return `${Math.floor(hours / 24)}d ago`;
}

function formatResetEstimate(isoString, accountKey) {
  const rateLimitReset = getRateLimitResetAt();
  if (rateLimitReset && accountKey) {
    const diff = rateLimitReset - Date.now();
    if (diff > 0) {
      const hours = Math.floor(diff / 3600000);
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `~${days}d ${remainingHours}h`;
      }
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      if (hours > 0) return `~${hours}h ${minutes}m`;
      if (minutes > 0) return `~${minutes}m ${seconds}s`;
      return `~${seconds}s`;
    }
  }

  if (!isoString) return 'unknown';
  const resetDate = new Date(new Date(isoString).getTime() + RESET_WINDOW_DAYS * 86400000);
  const diff = resetDate.getTime() - Date.now();
  if (diff <= 0) return 'reset now';
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `~${days}d ${remainingHours}h`;
}

function fetchUsage(accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
        'User-Agent': 'claude-cli/claude-code-multi-accounts',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 429) {
          const retrySecs = res.headers['retry-after'] ? parseInt(res.headers['retry-after'], 10) : null;
          if (retrySecs) setRateLimitResetAt(retrySecs);
          resolve({ rate_limited: true, retry_after: retrySecs });
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Usage API returned ${res.statusCode}: ${data}`));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (parsed?.seven_day?.resets_at) {
            setRateLimitResetAtFromIso(parsed.seven_day.resets_at);
          }
          resolve(parsed);
        } catch {
          reject(new Error(`Failed to parse usage response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Usage API timeout'));
    });
  });
}

function formatUsageInfo(usage) {
  const lines = [];
  if (usage.rate_limited) {
    const retrySecs = usage.retry_after ? parseInt(usage.retry_after, 10) : null;
    if (retrySecs) {
      const resetAt = new Date(Date.now() + retrySecs * 1000);
      const h = Math.floor(retrySecs / 3600);
      const m = Math.floor((retrySecs % 3600) / 60);
      const s = retrySecs % 60;
      let countdown = '';
      if (h > 0) countdown = `~${h}h ${m}m`;
      else if (m > 0) countdown = `~${m}m ${s}s`;
      else countdown = `~${s}s`;
      lines.push(`Usage API is rate limited. Resets in ${countdown} (at ${resetAt.toLocaleTimeString()}).`);
    } else {
      lines.push('Usage API is rate limited. Try again in a few seconds.');
    }
    return lines;
  }
  if (usage.five_hour) {
    const pct = typeof usage.five_hour.utilization === 'number' ? usage.five_hour.utilization.toFixed(1) : 'N/A';
    const resetsAt = usage.five_hour.resets_at ? new Date(usage.five_hour.resets_at).toLocaleString() : 'unknown';
    lines.push(`5h used/reset: ${pct}% / ${resetsAt}`);
  }
  if (usage.seven_day) {
    const pct = typeof usage.seven_day.utilization === 'number' ? usage.seven_day.utilization.toFixed(1) : 'N/A';
    const resetsAt = usage.seven_day.resets_at ? new Date(usage.seven_day.resets_at).toLocaleString() : 'unknown';
    lines.push(`7d used/reset: ${pct}% / ${resetsAt}`);
  }
  if (lines.length === 0) {
    lines.push('No usage data available for this account.');
  }
  return lines;
}

function toUsageSnapshot(usage) {
  if (!usage || usage.rate_limited) return null;
  const hasFiveHour = usage.five_hour && (typeof usage.five_hour.utilization === 'number' || usage.five_hour.resets_at);
  const hasSevenDay = usage.seven_day && (typeof usage.seven_day.utilization === 'number' || usage.seven_day.resets_at);
  if (!hasFiveHour && !hasSevenDay) return null;
  return {
    five_hour: usage.five_hour ? {
      utilization: usage.five_hour.utilization,
      resets_at: usage.five_hour.resets_at,
    } : undefined,
    seven_day: usage.seven_day ? {
      utilization: usage.seven_day.utilization,
      resets_at: usage.seven_day.resets_at,
    } : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function refreshStoredUsageSnapshots(store, currentKey) {
  let currentUsage = null;
  let changed = false;
  const currentEntry = store.accounts.find((e) => e.key === currentKey);
  if (!currentEntry) return { currentUsage, changed };
  const accessToken = currentEntry.credentials?.claudeAiOauth?.accessToken;
  if (!accessToken) return { currentUsage, changed };
  try {
    const usage = await fetchUsage(accessToken);
    currentUsage = usage;
    const nextSnapshot = toUsageSnapshot(usage);
    if (nextSnapshot) {
      const idx = store.accounts.findIndex((e) => e.key === currentKey);
      if (idx >= 0) {
        const before = JSON.stringify(store.accounts[idx].usageSnapshot || null);
        const after = JSON.stringify(nextSnapshot);
        if (before !== after) {
          store.accounts[idx].usageSnapshot = nextSnapshot;
          changed = true;
        }
      }
    }
  } catch {
    // Keep previous snapshot on failure.
  }
  return { currentUsage, changed };
}

function formatUsagePercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '?';
  return `${Math.round(value)}%`;
}

function formatDurationUntil(dateLike) {
  if (!dateLike) return 'unknown';
  const resetAt = new Date(dateLike).getTime();
  if (Number.isNaN(resetAt)) return 'unknown';
  const diff = resetAt - Date.now();
  if (diff <= 0) return 'now';
  const totalHours = Math.floor(diff / 3600000);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}D ${hours}h`;
  }
  const minutes = Math.floor((diff % 3600000) / 60000);
  return `~${totalHours}h ${minutes}min`;
}

function getUsageColumns(entry) {
  const usage = entry.usageSnapshot || {};
  const rateLimitReset = entry.current ? getRateLimitResetAt() : null;
  const fiveHourPct = formatUsagePercent(usage.five_hour?.utilization);
  const fiveHourReset = formatDurationUntil(usage.five_hour?.resets_at);
  const sevenDayPct = formatUsagePercent(usage.seven_day?.utilization);
  const sevenDayReset = formatDurationUntil(rateLimitReset || usage.seven_day?.resets_at);
  return `5H:${fiveHourPct}(${fiveHourReset}) | 7D:${sevenDayPct} (${sevenDayReset})`;
}

function formatAccountSummary(accounts) {
  return formatAccountSummaryUi(accounts, {
    formatRelativeTime: formatRelativeTimeUi,
    getUsageColumns: (entry) => getUsageColumnsUi(entry, getRateLimitResetAt),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    const config = readJson(options.configPath);
    const credentials = readJson(options.credentialsPath);
    const existingStore = normalizeStore(readJsonIfExists(options.storePath, { version: STORE_VERSION, accounts: [] }), STORE_VERSION);

    if (options.usageOnly) {
      const accessToken = credentials?.claudeAiOauth?.accessToken;
      if (!accessToken) {
        throw new Error('No access token found in credentials file.');
      }
      console.log('Fetching usage from Claude API...');
      const usage = await fetchUsageApi(accessToken, { setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir), setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir) });
      for (const line of formatUsageInfoUi(usage)) {
        console.log(line);
      }
      return;
    }

    if (options.syncOnly) {
      const result = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
      if (result.changed) {
        writeStore(result.store, options);
        console.log(`Synced current account into ${path.basename(options.storePath)}.`);
      } else {
        console.log(`${path.basename(options.storePath)} already matches the current account snapshot.`);
      }
      return;
    }

    if (options.removeOnly) {
      const removed = removeStoredAccount(existingStore, options.removeIndex);
      writeStore(existingStore, options);
      const name = getPreferredDisplayNameUi(removed.metadata || {});
      const email = (removed.metadata && removed.metadata.emailAddress) || '(no email)';
      console.log(`Removed account: [${options.removeIndex}] ${name} <${email}>`);
      console.log('');
      console.log(getRemainingAccountsHeading());
      for (const entry of existingStore.accounts) {
        const m = entry.metadata || {};
        console.log(`  [${entry.index}] ${getPreferredDisplayNameUi(m)} <${m.emailAddress || '(no email)'}>`);
      }
      return;
    }

    const synced = syncStoreFromLive(existingStore, config, credentials, deepCopy, STORE_VERSION);
    const store = synced.store;
    const accounts = getDisplayAccounts(store, config.oauthAccount);

    if (!options.selector) {
      if (synced.changed) {
        writeStore(store, options);
        console.log(`Saved the current account snapshot into ${path.basename(options.storePath)} before showing the account list.`);
      }

      const accessToken = credentials?.claudeAiOauth?.accessToken;
      if (accessToken) {
        try {
          const { currentUsage, changed } = await refreshStoredUsageSnapshotsUi(store, getAccountKey(config.oauthAccount), (token) => fetchUsageApi(token, { setRateLimitResetAt: (secs) => setRateLimitResetAt(secs, ensureDir), setRateLimitResetAtFromIso: (iso) => setRateLimitResetAtFromIso(iso, ensureDir) }));
          if (changed) {
            writeStore(store, options);
          }
          if (options.showUsage && currentUsage) {
            console.log('--- Usage ---');
            for (const line of formatUsageInfoUi(currentUsage)) {
              console.log(line);
            }
            console.log('');
          }
          console.log(getAvailableAccountsHeading());
          for (const line of formatAccountSummary(getDisplayAccounts(store, config.oauthAccount))) {
            console.log(line);
          }
          console.log('');
          for (const line of getListGuidance(options.usageCommand)) {
            console.log(line);
          }
          return;
        } catch {
          // Ignore usage refresh failures and render cached values.
        }
      }

      console.log(getAvailableAccountsHeading());
      for (const line of formatAccountSummary(accounts)) {
        console.log(line);
      }
      console.log('');
      for (const line of getListGuidance(options.usageCommand)) {
        console.log(line);
      }
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

    const currentAccounts = getDisplayAccounts(store, selected.metadata);
    const currentPlan = inferPlanTypeUi(selected);
    console.log(`Switched active account to [${selected.index}] ${getPreferredDisplayNameUi(selected.metadata)} <${selected.metadata.emailAddress}> (${currentPlan}).`);
    console.log('');
    console.log(getRestartNotice());
    console.log('');
    console.log(getStoredAccountsHeading());
    for (const line of formatAccountSummary(currentAccounts)) {
      console.log(line);
    }
  } catch (error) {
    console.log(`Switch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();

#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const STORE_VERSION = '0.2.2';
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

function getDefaultConfigDir() {
  return path.join(os.homedir(), '.claude', 'multi-account-switch');
}

function getSettingsPath() {
  return path.join(getDefaultConfigDir(), 'settings.json');
}

function readSettings() {
  const p = getSettingsPath();
  if (!fs.existsSync(p)) return { showUsage: true };
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { showUsage: true }; }
}

function writeSettings(s) {
  const p = getSettingsPath();
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function getRateLimitResetAt() {
  const s = readSettings();
  if (s.rateLimitResetAt) {
    const resetTime = new Date(s.rateLimitResetAt).getTime();
    if (resetTime > Date.now()) return resetTime;
  }
  return null;
}

function setRateLimitResetAt(retryAfterSecs) {
  const s = readSettings();
  s.rateLimitResetAt = new Date(Date.now() + retryAfterSecs * 1000).toISOString();
  writeSettings(s);
}

function setRateLimitResetAtFromIso(isoString) {
  if (!isoString) return;
  const resetTime = new Date(isoString).getTime();
  if (!Number.isNaN(resetTime) && resetTime > Date.now()) {
    const s = readSettings();
    s.rateLimitResetAt = new Date(resetTime).toISOString();
    writeSettings(s);
  }
}

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
    usageSnapshot: existingEntry?.usageSnapshot || undefined,
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

  throw new Error(`No account matched index '${trimmed}'. Use a numeric index.`);
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

function formatResetEstimate(isoString, accountKey) {
  const rateLimitReset = getRateLimitResetAt();
  if (rateLimitReset && accountKey) {
    const diff = rateLimitReset - Date.now();
    if (diff > 0) {
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        const remainingHours = hours % 24;
        return `~${days}d ${remainingHours}h`;
      }
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      if (hours > 0) return `~${hours}h ${minutes}m`;
      if (minutes > 0) return `~${minutes}m ${seconds}s`;
      return `~${seconds}s`;
    }
  }
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
          if (parsed && parsed.seven_day && parsed.seven_day.resets_at) {
            setRateLimitResetAtFromIso(parsed.seven_day.resets_at);
          }
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Failed to parse usage response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Usage API timeout')); });
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

  const orderedAccounts = [...store.accounts].sort((a, b) => {
    if (a.key === currentKey) return -1;
    if (b.key === currentKey) return 1;
    return 0;
  });

  for (const entry of orderedAccounts) {
    const accessToken = entry.credentials?.claudeAiOauth?.accessToken;
    if (!accessToken) continue;

    try {
      const usage = await fetchUsage(accessToken);
      if (entry.key === currentKey) {
        currentUsage = usage;
      }
      const nextSnapshot = toUsageSnapshot(usage);
      if (!nextSnapshot) continue;

      const idx = store.accounts.findIndex((e) => e.key === entry.key);
      if (idx >= 0) {
        const before = JSON.stringify(store.accounts[idx].usageSnapshot || null);
        const after = JSON.stringify(nextSnapshot);
        if (before !== after) {
          store.accounts[idx].usageSnapshot = nextSnapshot;
          changed = true;
        }
      }
    } catch {
      // Keep the previous snapshot if this refresh fails.
    }
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
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}D ${hours}h`;
  }
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
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
  return accounts.map((entry) => {
    const marker = entry.current ? '*' : ' ';
    const metadata = entry.metadata || {};
    const displayName = getPreferredDisplayName(metadata);
    const email = metadata.emailAddress && String(metadata.emailAddress).trim() ? metadata.emailAddress : '(no email)';
    const org = metadata.organizationName && String(metadata.organizationName).trim() ? metadata.organizationName : '(no organization)';
    const plan = inferPlanType(entry);
    const lastSynced = formatRelativeTime(entry.lastSyncedAt);
    const usageColumns = getUsageColumns(entry);
    return `${marker} [${entry.index}] ${displayName} <${email}> - ${org} - ${plan} | ${usageColumns} | synced: ${lastSynced}`;
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

    if (options.usageOnly) {
      const accessToken = credentials?.claudeAiOauth?.accessToken;
      if (!accessToken) {
        throw new Error('No access token found in credentials file.');
      }
      console.log('Fetching usage from Claude API...');
      return fetchUsage(accessToken).then((usage) => {
        for (const line of formatUsageInfo(usage)) {
          console.log(line);
        }
      });
    }

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

      if (options.showUsage) {
        const accessToken = credentials?.claudeAiOauth?.accessToken;
        if (accessToken) {
          return refreshStoredUsageSnapshots(store, getAccountKey(config.oauthAccount)).then(({ changed }) => {
            if (changed) {
              writeStore(store, options);
            }
            console.log('Available Claude accounts:');
            for (const line of formatAccountSummary(getDisplayAccounts(store, config.oauthAccount))) {
              console.log(line);
            }
            console.log('');
            console.log(`Run ${options.usageCommand} <index> to make one of these stored entries the active Claude account.`);
          }).catch((err) => {
            if (err.message && err.message.includes('401')) {
              console.log('Available Claude accounts:');
              for (const line of formatAccountSummary(getDisplayAccounts(store, config.oauthAccount))) {
                console.log(line);
              }
              console.log('');
              console.log(`Run ${options.usageCommand} <index> to make one of these stored entries the active Claude account.`);
              return;
            }
            console.log('Available Claude accounts:');
            for (const line of formatAccountSummary(getDisplayAccounts(store, config.oauthAccount))) {
              console.log(line);
            }
            console.log('');
            console.log(`Run ${options.usageCommand} <index> to make one of these stored entries the active Claude account.`);
          });
        }
      }

      console.log('Available Claude accounts:');
      for (const line of formatAccountSummary(accounts)) {
        console.log(line);
      }
      console.log('');
      console.log(`Run ${options.usageCommand} <index> to make one of these stored entries the active Claude account.`);
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
    const currentPlan = inferPlanType(selected);
    console.log(`Switched active account to [${selected.index}] ${getPreferredDisplayName(selected.metadata)} <${selected.metadata.emailAddress}> (${currentPlan}).`);
    console.log('');
    console.log('Note: Restart Claude Code to apply the account change.');
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

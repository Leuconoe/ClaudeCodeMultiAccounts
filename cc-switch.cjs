#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

function getDefaultConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

function getDefaultBackupDir() {
  return path.join(os.homedir(), '.claude', 'backups', 'multi-account-switch');
}

function parseArgs(argv) {
  const options = {
    usageCommand: '/switch',
    configPath: getDefaultConfigPath(),
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

function readClaudeConfig(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeClaudeConfig(config, filePath, backupDir) {
  ensureDir(backupDir);
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, path.join(backupDir, `claude.json.${timestamp}.bak`));
  }
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAccountKey(account) {
  if (account.accountUuid && String(account.accountUuid).trim()) {
    return `uuid:${String(account.accountUuid).trim().toLowerCase()}`;
  }
  if (account.emailAddress && String(account.emailAddress).trim()) {
    return `email:${String(account.emailAddress).trim().toLowerCase()}`;
  }
  throw new Error('Account entry is missing both accountUuid and emailAddress.');
}

function isSuspiciousDisplayName(value) {
  return value.includes('\uFFFD') || (value.match(/\?/g) || []).length >= 2;
}

function getPreferredDisplayName(account) {
  if (account.displayName && String(account.displayName).trim()) {
    const displayName = String(account.displayName).trim();
    if (!isSuspiciousDisplayName(displayName)) {
      return displayName;
    }
  }

  if (account.emailAddress && String(account.emailAddress).trim()) {
    const email = String(account.emailAddress).trim();
    const atIndex = email.indexOf('@');
    return atIndex > 0 ? email.slice(0, atIndex) : email;
  }

  return '(no display name)';
}

function inferPlanType(account) {
  const hasOrgScope = Boolean(account.organizationRole) || Boolean(account.workspaceRole);

  if (hasOrgScope) {
    return account.billingType === 'stripe_subscription' ? 'Teams' : 'Enterprise';
  }

  if (account.hasExtraUsageEnabled === true) {
    return 'Max';
  }

  if (account.billingType === 'stripe_subscription') {
    return 'Pro';
  }

  return 'Unknown';
}

function ensureOauthList(config) {
  if (!Array.isArray(config.oauthList)) {
    config.oauthList = [];
  }
  return config.oauthList;
}

function syncOauthAccountList(config) {
  if (!config.oauthAccount) {
    throw new Error('The Claude config does not contain oauthAccount.');
  }

  const existing = ensureOauthList(config);
  const seen = new Set();
  const deduped = [];
  const currentKey = getAccountKey(config.oauthAccount);
  let currentInserted = false;

  for (const entry of existing) {
    if (!entry) continue;
    const key = getAccountKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    if (key === currentKey) {
      deduped.push(deepCopy(config.oauthAccount));
      currentInserted = true;
    } else {
      deduped.push(deepCopy(entry));
    }
  }

  if (!currentInserted) {
    deduped.push(deepCopy(config.oauthAccount));
  }

  deduped.forEach((entry, index) => {
    entry.index = index;
  });

  const before = JSON.stringify(config.oauthList || []);
  const after = JSON.stringify(deduped);
  config.oauthList = deduped;

  return {
    changed: before !== after,
    list: config.oauthList,
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
    for (const candidate of [entry.accountUuid, entry.emailAddress, entry.displayName]) {
      if (candidate && String(candidate).trim().toLowerCase() === normalized) {
        return entry;
      }
    }
  }

  throw new Error(`No account matched selector '${selector}'.`);
}

function setCurrentOauthAccount(config, selectedAccount) {
  const nextAccount = deepCopy(selectedAccount);
  delete nextAccount.index;
  const before = config.oauthAccount ? JSON.stringify(config.oauthAccount) : null;
  const after = JSON.stringify(nextAccount);
  config.oauthAccount = nextAccount;
  return {
    changed: before !== after,
    account: nextAccount,
  };
}

function formatAccountSummary(accounts, currentAccount) {
  const currentKey = currentAccount ? getAccountKey(currentAccount) : null;
  return accounts.map((entry) => {
    const marker = currentKey && getAccountKey(entry) === currentKey ? '*' : ' ';
    const displayName = getPreferredDisplayName(entry);
    const email = entry.emailAddress && String(entry.emailAddress).trim() ? entry.emailAddress : '(no email)';
    const org = entry.organizationName && String(entry.organizationName).trim() ? entry.organizationName : '(no organization)';
    const plan = inferPlanType(entry);
    return `${marker} [${entry.index}] ${displayName} <${email}> - ${org} - ${plan}`;
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const config = readClaudeConfig(options.configPath);
    const sync = syncOauthAccountList(config);

    if (options.syncOnly) {
      if (sync.changed) {
        writeClaudeConfig(config, options.configPath, options.backupDir);
        console.log('Synced oauthAccount into oauthList.');
      } else {
        console.log('oauthList already matches oauthAccount.');
      }
      return;
    }

    if (!options.selector) {
      if (sync.changed) {
        writeClaudeConfig(config, options.configPath, options.backupDir);
        console.log('Synced the active oauthAccount into oauthList before showing the account list.');
      }
      console.log('Available Claude accounts:');
      for (const line of formatAccountSummary(config.oauthList, config.oauthAccount)) {
        console.log(line);
      }
      console.log('');
      console.log(`Run ${options.usageCommand} <index|email|accountUuid> to make one of these entries the active oauthAccount.`);
      return;
    }

    const selected = findSelection(config.oauthList, options.selector);
    const switchResult = setCurrentOauthAccount(config, selected);
    const postSwitchSync = syncOauthAccountList(config);
    if (sync.changed || switchResult.changed || postSwitchSync.changed) {
      writeClaudeConfig(config, options.configPath, options.backupDir);
    }

    const currentKey = getAccountKey(config.oauthAccount);
    const currentEntry = config.oauthList.find((entry) => getAccountKey(entry) === currentKey);
    const currentIndex = currentEntry ? currentEntry.index : '?';
    const currentPlan = inferPlanType(config.oauthAccount);
    console.log(`Switched active oauthAccount to [${currentIndex}] ${getPreferredDisplayName(config.oauthAccount)} <${config.oauthAccount.emailAddress}> (${currentPlan}).`);
    console.log('');
    console.log('Current account list:');
    for (const line of formatAccountSummary(config.oauthList, config.oauthAccount)) {
      console.log(line);
    }
  } catch (error) {
    console.log(`Switch failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main();

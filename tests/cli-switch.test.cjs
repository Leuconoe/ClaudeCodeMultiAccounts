const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'cc-switch.cjs');
const NOW = Date.now();

function makeFixtures({ storedSlotExpired = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-cli-test-'));
  const configPath = path.join(dir, '.claude.json');
  const credentialsPath = path.join(dir, '.credentials.json');
  const storePath = path.join(dir, 'store.json');
  const backupDir = path.join(dir, 'backups');

  const config = {
    oauthAccount: {
      accountUuid: 'uuid-live-a',
      emailAddress: 'live-a@test.com',
      organizationRole: 'admin',
    },
    unrelatedTopLevelKey: 'must-survive',
  };

  const credentials = {
    claudeAiOauth: {
      accessToken: 'live-access-a',
      refreshToken: 'live-refresh-a',
      expiresAt: NOW + 3600000,
      refreshTokenExpiresAt: NOW + 86400000,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      rateLimitTier: 'default',
    },
    futureCcSiblingKey: { deviceId: 'must-survive' },
  };

  const storedSlot = {
    key: 'uuid:uuid-stored-b',
    metadata: { accountUuid: 'uuid-stored-b', emailAddress: 'stored-b@test.com' },
    credentials: {
      claudeAiOauth: {
        accessToken: 'stored-access-b',
        refreshToken: 'stored-refresh-b',
        expiresAt: storedSlotExpired ? NOW - 3600000 : NOW + 3600000,
        refreshTokenExpiresAt: storedSlotExpired ? NOW - 1000 : NOW + 86400000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_5x',
      },
    },
    capturedAt: new Date(NOW - 100000).toISOString(),
    lastSyncedAt: new Date(NOW - 100000).toISOString(),
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2), 'utf8');
  fs.writeFileSync(storePath, JSON.stringify({ version: '0.2.9', accounts: [storedSlot] }, null, 2), 'utf8');

  return { dir, configPath, credentialsPath, storePath, backupDir };
}

function runCli(fixtures, args, env = {}) {
  return execFileSync(process.execPath, [
    CLI,
    ...args,
    '--config', fixtures.configPath,
    '--credentials', fixtures.credentialsPath,
    '--store', fixtures.storePath,
    '--backup-dir', fixtures.backupDir,
  ], {
    encoding: 'utf8',
    // Session count and the settings dir are machine state; pin both so the
    // tests do not depend on whether Claude Code happens to be running.
    env: { ...process.env, CC_SWITCH_SESSION_COUNT: '0', HOME: fixtures.dir, USERPROFILE: fixtures.dir, ...env },
  });
}

test('switch to valid stored slot: swaps both live files, preserves siblings, no re-login path', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['0']);

  assert.match(output, /Switched active account to \[0\]/);

  const config = JSON.parse(fs.readFileSync(fixtures.configPath, 'utf8'));
  assert.strictEqual(config.oauthAccount.accountUuid, 'uuid-stored-b');
  assert.strictEqual(config.unrelatedTopLevelKey, 'must-survive');

  const credentials = JSON.parse(fs.readFileSync(fixtures.credentialsPath, 'utf8'));
  assert.strictEqual(credentials.claudeAiOauth.accessToken, 'stored-access-b');
  assert.deepStrictEqual(credentials.futureCcSiblingKey, { deviceId: 'must-survive' });

  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  assert.strictEqual(store.accounts.length, 2);
  const outgoing = store.accounts.find((e) => e.key === 'uuid:uuid-live-a');
  assert.ok(outgoing, 'outgoing live account must be captured into the store before switching');
  assert.strictEqual(outgoing.credentials.claudeAiOauth.accessToken, 'live-access-a');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('switch to dead slot (refresh token expired): aborts, live files untouched, exit 1', () => {
  const fixtures = makeFixtures({ storedSlotExpired: true });
  const configBefore = fs.readFileSync(fixtures.configPath, 'utf8');
  const credentialsBefore = fs.readFileSync(fixtures.credentialsPath, 'utf8');

  let failed = null;
  try {
    runCli(fixtures, ['0']);
  } catch (error) {
    failed = error;
  }

  assert.ok(failed, 'CLI must exit non-zero');
  assert.strictEqual(failed.status, 1);
  assert.match(String(failed.stdout), /Switch aborted/);
  assert.match(String(failed.stdout), /\/login/);

  assert.strictEqual(fs.readFileSync(fixtures.configPath, 'utf8'), configBefore);
  assert.strictEqual(fs.readFileSync(fixtures.credentialsPath, 'utf8'), credentialsBefore);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('running sessions: switch is refused and staged instead of applied', () => {
  const fixtures = makeFixtures();
  const configBefore = fs.readFileSync(fixtures.configPath, 'utf8');
  const credentialsBefore = fs.readFileSync(fixtures.credentialsPath, 'utf8');

  let failed = null;
  try {
    runCli(fixtures, ['0'], { CC_SWITCH_SESSION_COUNT: '3' });
  } catch (error) {
    failed = error;
  }

  assert.ok(failed, 'must exit non-zero rather than report a switch it cannot make');
  assert.strictEqual(failed.status, 1);
  assert.match(String(failed.stdout), /Cannot switch now: 3 Claude Code session\(s\) are running/);
  assert.match(String(failed.stdout), /Staged switch to \[0\]/);
  assert.doesNotMatch(String(failed.stdout), /Switched active account/);

  // Live files untouched by a staged switch.
  assert.strictEqual(fs.readFileSync(fixtures.configPath, 'utf8'), configBefore);
  assert.strictEqual(fs.readFileSync(fixtures.credentialsPath, 'utf8'), credentialsBefore);

  // The staged intent is recorded under the pinned home dir.
  const settings = JSON.parse(fs.readFileSync(path.join(fixtures.dir, '.claude', 'multi-account-switch', 'settings.json'), 'utf8'));
  assert.strictEqual(settings.stagedSwitch.key, 'uuid:uuid-stored-b');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('staged switch applies on a later bare invocation with no sessions running', () => {
  const fixtures = makeFixtures();

  try {
    runCli(fixtures, ['0'], { CC_SWITCH_SESSION_COUNT: '3' });
  } catch {
    // expected: staged, not applied
  }

  const output = runCli(fixtures, [], { CC_SWITCH_SESSION_COUNT: '0' });
  assert.match(output, /Applying staged switch/);
  assert.match(output, /Switched active account to \[0\]/);

  const config = JSON.parse(fs.readFileSync(fixtures.configPath, 'utf8'));
  assert.strictEqual(config.oauthAccount.accountUuid, 'uuid-stored-b');

  const settings = JSON.parse(fs.readFileSync(path.join(fixtures.dir, '.claude', 'multi-account-switch', 'settings.json'), 'utf8'));
  assert.ok(!settings.stagedSwitch, 'the staged record is cleared once applied');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('cancel discards a staged switch', () => {
  const fixtures = makeFixtures();
  try {
    runCli(fixtures, ['0'], { CC_SWITCH_SESSION_COUNT: '3' });
  } catch {
    // expected
  }

  const output = runCli(fixtures, ['cancel']);
  assert.match(output, /Cancelled the staged switch/);
  const settings = JSON.parse(fs.readFileSync(path.join(fixtures.dir, '.claude', 'multi-account-switch', 'settings.json'), 'utf8'));
  assert.ok(!settings.stagedSwitch);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('regression: sync captures live account into store', () => {
  const fixtures = makeFixtures();
  const output = runCli(fixtures, ['sync']);

  assert.match(output, /Synced current account/);
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  assert.ok(store.accounts.some((e) => e.key === 'uuid:uuid-live-a'));

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

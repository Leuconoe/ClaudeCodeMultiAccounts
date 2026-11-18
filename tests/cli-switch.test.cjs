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

function prepareSessionFixtures(t, { expired = true, statusCode = 200 } = {}) {
  const fixtures = makeFixtures();
  t.after(() => fs.rmSync(fixtures.dir, { recursive: true, force: true }));
  const credentials = JSON.parse(fs.readFileSync(fixtures.credentialsPath, 'utf8'));
  credentials.claudeAiOauth.expiresAt = expired ? NOW - 3600000 : NOW + 3600000;
  fs.writeFileSync(fixtures.credentialsPath, JSON.stringify(credentials));
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  store.accounts[0].credentials.claudeAiOauth.expiresAt = NOW - 3600000;
  store.accounts.push({
    key: 'uuid:uuid-live-a',
    metadata: JSON.parse(fs.readFileSync(fixtures.configPath, 'utf8')).oauthAccount,
    credentials,
    alias: 'Personal',
    usageSnapshot: {
      five_hour: { utilization: 22, resets_at: new Date(NOW + 3600000).toISOString() },
      seven_day: { utilization: 6, resets_at: new Date(NOW + 86400000).toISOString() },
      fetchedAt: new Date(NOW - 60000).toISOString(),
    },
  });
  fs.writeFileSync(fixtures.storePath, JSON.stringify(store));
  const preload = path.join(fixtures.dir, 'mock-usage.cjs');
  // Every request is mocked: session display tests must never use real tokens
  // or depend on API availability. Expired tokens must not be queried at all.
  fs.writeFileSync(preload, `
    const { EventEmitter } = require('node:events');
    require('node:https').get = (url, options, callback) => {
      ${expired ? 'process.exit(91); // Expired tokens must not be queried.' : ''}
      const req = new EventEmitter();
      req.setTimeout = () => {};
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = ${statusCode};
        res.headers = {};
        callback(res);
        res.emit('data', ${JSON.stringify(JSON.stringify(statusCode === 200 ? { five_hour: { utilization: 10 } } : { error: 'secret-response-body' }))});
        res.emit('end');
      });
      return req;
    };
  `);
  return { fixtures, env: { NODE_OPTIONS: `--require="${preload.replace(/\\/g, '/')}"` } };
}

test('expired current session: lists accounts, expiry and cached usage with renewal guidance', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  const credentialsBefore = fs.readFileSync(fixtures.credentialsPath, 'utf8');
  const output = runCli(fixtures, [], env);
  assert.match(output, /Account: \[1\] Personal \(live-a@test.com\) \| Pro/);
  assert.match(output, /Session: expired - refresh required/);
  assert.match(output, /Access token expires:/);
  assert.match(output, /Refresh token expires:/);
  assert.match(output, /Run 'ccs 1' to refresh/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.match(output, /5h remaining\/reset: 78\.0%/);
  assert.match(output, /Available Claude accounts:/);
  assert.match(output, /\* \[1\] Personal .*session:expired - refresh required/);
  assert.doesNotMatch(output, /live-access-a|live-refresh-a|Switch failed/);
  assert.strictEqual(fs.readFileSync(fixtures.credentialsPath, 'utf8'), credentialsBefore);
});

test('usage command: expired current session still shows cached usage and expiry', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  const output = runCli(fixtures, ['usage'], env);
  assert.match(output, /Session: expired - refresh required/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.match(output, /7d remaining\/reset: 94\.0%/);
});

test('missing credentials: preserves stored snapshots and shows current session and account list', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  fs.unlinkSync(fixtures.credentialsPath);
  const storeBefore = fs.readFileSync(fixtures.storePath, 'utf8');
  const output = runCli(fixtures, [], env);
  assert.match(output, /Session: credentials missing - login required/);
  assert.match(output, /Access token expires \(stored\):/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.match(output, /\* \[1\] Personal .*session:credentials missing - login required/);
  assert.match(output, /\/login/);
  assert.strictEqual(fs.readFileSync(fixtures.storePath, 'utf8'), storeBefore);
  assert.strictEqual(fs.existsSync(fixtures.credentialsPath), false);
});

test('missing oauth login: shows stored accounts without guessing which account is current', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  fs.writeFileSync(fixtures.configPath, '{}');
  fs.writeFileSync(fixtures.credentialsPath, '{}');
  const output = runCli(fixtures, [], env);
  assert.match(output, /Current account is unknown/);
  assert.match(output, /Available Claude accounts:/);
  assert.match(output, /\[1\] Personal/);
  assert.doesNotMatch(output, /\* \[/);
});

test('API 401: shows renewal notice and cached usage even before local token expiry', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t, { expired: false, statusCode: 401 });
  const output = runCli(fixtures, [], env);
  assert.match(output, /Session: authentication rejected - refresh required/);
  assert.match(output, /Session renewal is required/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.match(output, /\* \[1\] Personal .*session:authentication rejected - refresh required/);
  assert.doesNotMatch(output, /secret-response-body|live-access-a|live-refresh-a/);
});

test('API server failure: uses cached usage without falsely reporting an expired login', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t, { expired: false, statusCode: 500 });
  const output = runCli(fixtures, [], env);
  assert.match(output, /Session: active/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.doesNotMatch(output, /Session renewal is required/);
});

test('healthy current session: displays fresh usage without a renewal notice', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t, { expired: false });
  const output = runCli(fixtures, [], env);
  assert.match(output, /Session: active/);
  assert.match(output, /5h remaining\/reset: 90\.0%/);
  assert.doesNotMatch(output, /Usage \(cached|Session renewal is required/);
});

test('hard-expired refresh token: retains session details and cached usage with login guidance', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  const credentials = JSON.parse(fs.readFileSync(fixtures.credentialsPath, 'utf8'));
  credentials.claudeAiOauth.refreshTokenExpiresAt = NOW - 1000;
  fs.writeFileSync(fixtures.credentialsPath, JSON.stringify(credentials));
  const output = runCli(fixtures, [], env);
  assert.match(output, /Account: \[1\] Personal/);
  assert.match(output, /Session: expired - login required/);
  assert.match(output, /Usage \(cached; fetched:/);
  assert.match(output, /\/login/);
  assert.doesNotMatch(output, /Run 'ccs 1' to refresh/);
});

test('expired session without a usage cache: still shows session details and stored accounts', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  delete store.accounts[1].usageSnapshot;
  fs.writeFileSync(fixtures.storePath, JSON.stringify(store));
  const output = runCli(fixtures, [], env);
  assert.match(output, /Session: expired - refresh required/);
  assert.match(output, /No usage data available for the current account/);
  assert.match(output, /Available Claude accounts:/);
  assert.match(output, /\* \[1\] Personal/);
});

function replaceLiveTokens(fixtures) {
  const credentials = JSON.parse(fs.readFileSync(fixtures.credentialsPath, 'utf8'));
  credentials.claudeAiOauth.accessToken = 'new-live-access';
  credentials.claudeAiOauth.refreshToken = 'new-live-refresh';
  fs.writeFileSync(fixtures.credentialsPath, JSON.stringify(credentials));
}

function assertLiveSnapshotSynced(fixtures) {
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  const current = store.accounts.filter((entry) => entry.key === 'uuid:uuid-live-a');
  assert.strictEqual(current.length, 1);
  assert.strictEqual(current[0].credentials.claudeAiOauth.accessToken, 'new-live-access');
  assert.strictEqual(current[0].credentials.claudeAiOauth.refreshToken, 'new-live-refresh');
}

test('bare ccs automatically captures rotated live tokens before listing accounts', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  replaceLiveTokens(fixtures);
  const output = runCli(fixtures, [], env);
  assert.match(output, /Synced current account into store.json/);
  assertLiveSnapshotSynced(fixtures);
  const store = JSON.parse(fs.readFileSync(fixtures.storePath, 'utf8'));
  assert.strictEqual(store.accounts[1].alias, 'Personal');
  assert.ok(store.accounts[1].usageSnapshot);
});

test('usage without fresh API data still persists the automatic login sync', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  replaceLiveTokens(fixtures);
  const output = runCli(fixtures, ['usage'], env);
  assert.match(output, /Usage \(cached; fetched:/);
  assertLiveSnapshotSynced(fixtures);
});

test('blocked switch persists the automatic login sync before staging', (t) => {
  const { fixtures, env } = prepareSessionFixtures(t);
  replaceLiveTokens(fixtures);
  assert.throws(() => runCli(fixtures, ['0', '--no-watch'], { ...env, CC_SWITCH_SESSION_COUNT: '2' }), (error) => {
    assert.strictEqual(error.status, 1);
    assert.match(String(error.stdout), /Staged switch to \[0\]/);
    return true;
  });
  assertLiveSnapshotSynced(fixtures);
});

for (const args of [['--rename', '0', 'Work'], ['--remove', '0']]) {
  test(`${args[0]} syncs the live account before updating stored accounts`, (t) => {
    const { fixtures, env } = prepareSessionFixtures(t);
    replaceLiveTokens(fixtures);
    runCli(fixtures, args, env);
    assertLiveSnapshotSynced(fixtures);
  });
}

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSwitchPipeline } = require('../lib/actions/switch-pipeline.cjs');
const { assessCredentials } = require('../lib/auth/guard.cjs');
const io = require('../lib/store/io.cjs');
const messages = require('../lib/output/messages.cjs');

const NOW = Date.now();

function makeFixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-pipeline-test-'));
  const options = {
    usageCommand: '/switch',
    configPath: path.join(dir, '.claude.json'),
    credentialsPath: path.join(dir, '.credentials.json'),
    storePath: path.join(dir, 'store.json'),
    backupDir: path.join(dir, 'backups'),
  };

  const config = { oauthAccount: { accountUuid: 'uuid-a', emailAddress: 'a@test.com' }, keep: true };
  const liveCredentials = {
    claudeAiOauth: { accessToken: 'live-a', refreshToken: 'live-refresh-a', expiresAt: NOW + 3600000 },
    sibling: 'must-survive',
  };
  const expiredSlot = {
    key: 'uuid:uuid-b',
    index: 0,
    metadata: { accountUuid: 'uuid-b', emailAddress: 'b@test.com' },
    credentials: {
      claudeAiOauth: {
        accessToken: 'stale-access-b',
        refreshToken: 'stale-refresh-b',
        expiresAt: NOW - 3600000,
        refreshTokenExpiresAt: NOW + 86400000,
        subscriptionType: 'max',
      },
    },
  };
  const store = { version: '0.2.9', accounts: [JSON.parse(JSON.stringify(expiredSlot))] };

  fs.writeFileSync(options.configPath, JSON.stringify(config, null, 2), 'utf8');
  fs.writeFileSync(options.credentialsPath, JSON.stringify(liveCredentials, null, 2), 'utf8');
  fs.writeFileSync(options.storePath, JSON.stringify(store, null, 2), 'utf8');

  return { dir, options, config, store, selected: { ...expiredSlot, credentials: store.accounts[0].credentials } };
}

function baseContext(fixtures, overrides = {}) {
  return {
    selected: fixtures.selected,
    store: fixtures.store,
    config: fixtures.config,
    options: fixtures.options,
    deepCopy: io.deepCopy,
    writeLiveState: io.writeLiveState,
    writeStore: io.writeStore,
    assessCredentials,
    detectClaudeSessions: () => ({ detected: true, count: 0 }),
    now: () => NOW,
    log: () => {},
    messages,
    ...overrides,
  };
}

test('pipeline: expired slot -> refresh 200 -> rotated token persisted to store BEFORE live write', async () => {
  const fixtures = makeFixtures();
  const sequence = [];

  const context = baseContext(fixtures, {
    refreshTokens: async () => ({
      ok: true,
      claudeAiOauth: {
        accessToken: 'rotated-access-b',
        refreshToken: 'rotated-refresh-b',
        expiresAt: NOW + 28800000,
        refreshTokenExpiresAt: NOW + 86400000,
        subscriptionType: 'max',
      },
    }),
    writeStore: (store, options) => {
      sequence.push('store');
      io.writeStore(store, options);
    },
    writeLiveState: (config, credentials, options) => {
      sequence.push('live');
      const persisted = JSON.parse(fs.readFileSync(options.storePath, 'utf8'));
      const slot = persisted.accounts.find((e) => e.key === 'uuid:uuid-b');
      assert.strictEqual(
        slot.credentials.claudeAiOauth.refreshToken,
        'rotated-refresh-b',
        'rotated single-use refresh token must already be on disk in the store before the live swap',
      );
      io.writeLiveState(config, credentials, options);
    },
  });

  const result = await runSwitchPipeline(context);

  assert.strictEqual(result.switched, true);
  assert.strictEqual(result.refreshed, true);
  assert.deepStrictEqual(sequence, ['store', 'live']);

  const liveCredentials = JSON.parse(fs.readFileSync(fixtures.options.credentialsPath, 'utf8'));
  assert.strictEqual(liveCredentials.claudeAiOauth.accessToken, 'rotated-access-b');
  assert.strictEqual(liveCredentials.sibling, 'must-survive');

  const liveConfig = JSON.parse(fs.readFileSync(fixtures.options.configPath, 'utf8'));
  assert.strictEqual(liveConfig.oauthAccount.accountUuid, 'uuid-b');

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('pipeline: refresh rejected with 400 (revoked) -> abort, no file writes at all', async () => {
  const fixtures = makeFixtures();
  const configBefore = fs.readFileSync(fixtures.options.configPath, 'utf8');
  const credentialsBefore = fs.readFileSync(fixtures.options.credentialsPath, 'utf8');
  const storeBefore = fs.readFileSync(fixtures.options.storePath, 'utf8');
  const sequence = [];

  const context = baseContext(fixtures, {
    refreshTokens: async () => ({ ok: false, code: 'revoked', message: 'the stored refresh token was rejected' }),
    writeStore: () => { sequence.push('store'); },
    writeLiveState: () => { sequence.push('live'); },
  });

  const result = await runSwitchPipeline(context);

  assert.strictEqual(result.switched, false);
  assert.strictEqual(result.abort.code, 'revoked');
  assert.deepStrictEqual(sequence, []);
  assert.strictEqual(fs.readFileSync(fixtures.options.configPath, 'utf8'), configBefore);
  assert.strictEqual(fs.readFileSync(fixtures.options.credentialsPath, 'utf8'), credentialsBefore);
  assert.strictEqual(fs.readFileSync(fixtures.options.storePath, 'utf8'), storeBefore);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

test('pipeline: valid slot -> no refresh call, straight switch', async () => {
  const fixtures = makeFixtures();
  fixtures.selected.credentials.claudeAiOauth.expiresAt = NOW + 3600000;
  fixtures.store.accounts[0].credentials.claudeAiOauth.expiresAt = NOW + 3600000;
  let refreshCalls = 0;

  const context = baseContext(fixtures, {
    refreshTokens: async () => { refreshCalls += 1; return { ok: false, code: 'network', message: 'should not be called' }; },
  });

  const result = await runSwitchPipeline(context);

  assert.strictEqual(result.switched, true);
  assert.strictEqual(result.refreshed, false);
  assert.strictEqual(refreshCalls, 0);

  fs.rmSync(fixtures.dir, { recursive: true, force: true });
});

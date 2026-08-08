const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runWatchLoop, isProcessAlive } = require('../lib/actions/watcher.cjs');

const CLI = path.join(__dirname, '..', 'cc-switch.cjs');

function fakeClock() {
  let current = 1_800_000_000_000;
  return {
    now: () => current,
    sleep: async (ms) => { current += ms; },
    advance: (ms) => { current += ms; },
  };
}

test('watchLoop: waits while sessions are running, applies when they reach zero', async () => {
  const clock = fakeClock();
  let ticks = 0;
  let applied = 0;

  const result = await runWatchLoop({
    detectClaudeSessions: () => {
      ticks += 1;
      return { detected: true, count: ticks < 4 ? 2 : 0 };
    },
    readStaged: () => ({ key: 'uuid:a' }),
    applyNow: async () => { applied += 1; return true; },
    sleep: clock.sleep,
    now: clock.now,
    pollMs: 1000,
  });

  assert.strictEqual(result.outcome, 'applied');
  assert.strictEqual(applied, 1);
  assert.strictEqual(ticks, 4, 'should poll until the session count drops to zero');
});

test('watchLoop: exits without applying when the staged switch is cancelled', async () => {
  const clock = fakeClock();
  let polls = 0;
  let applied = 0;

  const result = await runWatchLoop({
    detectClaudeSessions: () => { polls += 1; return { detected: true, count: 1 }; },
    readStaged: () => (polls < 3 ? { key: 'uuid:a' } : null),
    applyNow: async () => { applied += 1; return true; },
    sleep: clock.sleep,
    now: clock.now,
    pollMs: 1000,
  });

  assert.strictEqual(result.outcome, 'cancelled');
  assert.strictEqual(applied, 0);
});

test('watchLoop: a cancel that lands while sleeping is honoured before applying', async () => {
  const clock = fakeClock();
  let staged = { key: 'uuid:a' };
  let applied = 0;
  let reads = 0;

  const result = await runWatchLoop({
    detectClaudeSessions: () => ({ detected: true, count: 0 }),
    readStaged: () => {
      reads += 1;
      // First read (loop head) sees the record, the re-check right before
      // applying sees the cancellation.
      if (reads >= 2) staged = null;
      return staged;
    },
    applyNow: async () => { applied += 1; return true; },
    sleep: clock.sleep,
    now: clock.now,
  });

  assert.strictEqual(result.outcome, 'cancelled');
  assert.strictEqual(applied, 0);
});

test('watchLoop: gives up after the maximum wait', async () => {
  const clock = fakeClock();
  const result = await runWatchLoop({
    detectClaudeSessions: () => ({ detected: true, count: 1 }),
    readStaged: () => ({ key: 'uuid:a' }),
    applyNow: async () => true,
    sleep: clock.sleep,
    now: clock.now,
    pollMs: 60_000,
    maxWaitMs: 300_000,
  });

  assert.strictEqual(result.outcome, 'timeout');
});

test('watchLoop: reports a failed apply instead of claiming success', async () => {
  const clock = fakeClock();
  const result = await runWatchLoop({
    detectClaudeSessions: () => ({ detected: true, count: 0 }),
    readStaged: () => ({ key: 'uuid:a' }),
    applyNow: async () => false,
    sleep: clock.sleep,
    now: clock.now,
  });

  assert.strictEqual(result.outcome, 'apply-failed');
});

test('isProcessAlive: true for this process, false for a free pid', () => {
  assert.strictEqual(isProcessAlive(process.pid), true);
  assert.strictEqual(isProcessAlive(0), false);
  assert.strictEqual(isProcessAlive(undefined), false);
});

test('end-to-end: --watch-apply applies a staged switch once no session is running', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-watch-e2e-'));
  const configPath = path.join(dir, '.claude.json');
  const credentialsPath = path.join(dir, '.credentials.json');
  const storePath = path.join(dir, 'store.json');
  const backupDir = path.join(dir, 'backups');
  const now = Date.now();

  fs.writeFileSync(configPath, JSON.stringify({
    oauthAccount: { accountUuid: 'uuid-live-a', emailAddress: 'a@test.com' },
  }, null, 2), 'utf8');
  fs.writeFileSync(credentialsPath, JSON.stringify({
    claudeAiOauth: {
      accessToken: 'live-a', refreshToken: 'live-refresh-a',
      expiresAt: now + 3600000, refreshTokenExpiresAt: now + 86400000,
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(storePath, JSON.stringify({
    version: '0.2.9',
    accounts: [{
      key: 'uuid:uuid-stored-b',
      metadata: { accountUuid: 'uuid-stored-b', emailAddress: 'b@test.com' },
      credentials: {
        claudeAiOauth: {
          accessToken: 'stored-b', refreshToken: 'stored-refresh-b',
          expiresAt: now + 3600000, refreshTokenExpiresAt: now + 86400000,
        },
      },
    }],
  }, null, 2), 'utf8');

  const baseArgs = [
    '--config', configPath,
    '--credentials', credentialsPath,
    '--store', storePath,
    '--backup-dir', backupDir,
  ];
  const env = { ...process.env, HOME: dir, USERPROFILE: dir };

  // Stage while "sessions are running", without spawning a real watcher.
  try {
    execFileSync(process.execPath, [CLI, '0', ...baseArgs, '--no-watch'], {
      encoding: 'utf8',
      env: { ...env, CC_SWITCH_SESSION_COUNT: '2' },
    });
    assert.fail('staging should exit non-zero');
  } catch (error) {
    assert.strictEqual(error.status, 1);
    assert.match(String(error.stdout), /Staged switch to \[0\]/);
  }

  const settingsPath = path.join(dir, '.claude', 'multi-account-switch', 'settings.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).stagedSwitch.key, 'uuid:uuid-stored-b');
  assert.strictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).oauthAccount.accountUuid, 'uuid-live-a');

  // Now run the watcher in the foreground with no sessions: it should apply at once.
  const watchOutput = execFileSync(process.execPath, [CLI, '--watch-apply', ...baseArgs], {
    encoding: 'utf8',
    env: { ...env, CC_SWITCH_SESSION_COUNT: '0' },
    timeout: 30000,
  });

  assert.match(watchOutput, /Watcher finished: applied/);
  assert.strictEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')).oauthAccount.accountUuid, 'uuid-stored-b');
  assert.strictEqual(JSON.parse(fs.readFileSync(credentialsPath, 'utf8')).claudeAiOauth.accessToken, 'stored-b');
  assert.ok(!JSON.parse(fs.readFileSync(settingsPath, 'utf8')).stagedSwitch, 'staged record cleared after applying');

  fs.rmSync(dir, { recursive: true, force: true });
});

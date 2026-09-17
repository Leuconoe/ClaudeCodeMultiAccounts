const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  writeJsonAtomic,
  mergeCredentialsWrite,
  readJson,
  backupFile,
  readCredentials,
  writeCredentials,
  verifyLiveState,
} = require('../lib/store/io.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-io-test-'));
}

test('writeJsonAtomic: writes valid JSON and leaves no temp files', () => {
  const dir = tempDir();
  const target = path.join(dir, 'out.json');
  writeJsonAtomic(target, { hello: 'world' });

  assert.deepStrictEqual(readJson(target), { hello: 'world' });
  const leftovers = fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'));
  assert.strictEqual(leftovers.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic: overwrites existing file', () => {
  const dir = tempDir();
  const target = path.join(dir, 'out.json');
  writeJsonAtomic(target, { v: 1 });
  writeJsonAtomic(target, { v: 2 });
  assert.deepStrictEqual(readJson(target), { v: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeCredentialsWrite: replaces claudeAiOauth, preserves sibling keys', () => {
  const dir = tempDir();
  const target = path.join(dir, '.credentials.json');
  fs.writeFileSync(target, JSON.stringify({
    claudeAiOauth: { accessToken: 'old' },
    futureCcKey: { deviceId: 'must-survive' },
  }), 'utf8');

  mergeCredentialsWrite(target, { claudeAiOauth: { accessToken: 'new' } });

  const result = readJson(target);
  assert.strictEqual(result.claudeAiOauth.accessToken, 'new');
  assert.deepStrictEqual(result.futureCcKey, { deviceId: 'must-survive' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeCredentialsWrite: writes snapshot whole when live file is missing', () => {
  const dir = tempDir();
  const target = path.join(dir, '.credentials.json');
  mergeCredentialsWrite(target, { claudeAiOauth: { accessToken: 'fresh' } });
  assert.strictEqual(readJson(target).claudeAiOauth.accessToken, 'fresh');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('mergeCredentialsWrite: recovers when live file is corrupt', () => {
  const dir = tempDir();
  const target = path.join(dir, '.credentials.json');
  fs.writeFileSync(target, '{not valid json', 'utf8');
  mergeCredentialsWrite(target, { claudeAiOauth: { accessToken: 'recovered' } });
  assert.strictEqual(readJson(target).claudeAiOauth.accessToken, 'recovered');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeJsonAtomic: preserves restrictive file permissions on POSIX', { skip: process.platform === 'win32' }, () => {
  const dir = tempDir();
  const target = path.join(dir, '.credentials.json');
  fs.writeFileSync(target, '{}', { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(target, 0o600);
  writeJsonAtomic(target, { claudeAiOauth: { accessToken: 'x' } });
  assert.strictEqual(fs.statSync(target).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readJson: corrupt JSON error names the file but never quotes its content', () => {
  const dir = tempDir();
  const target = path.join(dir, '.credentials.json');
  fs.writeFileSync(target, '{"secret-token-value-abc123"', 'utf8');
  assert.throws(() => readJson(target), (error) => {
    assert.match(error.message, /\.credentials\.json/);
    assert.doesNotMatch(error.message, /secret-token-value/);
    return true;
  });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('backupFile: retention is per source file, not global across the backup dir', async () => {
  const dir = tempDir();
  const backupDir = path.join(dir, 'backups');
  const fileA = path.join(dir, '.claude.json');
  const fileB = path.join(dir, '.credentials.json');
  fs.writeFileSync(fileA, '{"a":1}', 'utf8');
  fs.writeFileSync(fileB, '{"b":1}', 'utf8');

  // Interleave 4 backups of each; timestamps have 1s resolution so nudge names apart.
  for (let i = 0; i < 4; i += 1) {
    backupFile(fileA, backupDir);
    backupFile(fileB, backupDir);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  const names = fs.readdirSync(backupDir);
  const aBackups = names.filter((n) => n.startsWith('.claude.json.'));
  const bBackups = names.filter((n) => n.startsWith('.credentials.json.'));
  assert.strictEqual(aBackups.length, 3, '.claude.json backups must survive .credentials.json pruning');
  assert.strictEqual(bBackups.length, 3);
  fs.rmSync(dir, { recursive: true, force: true });
});

function keychainExecFactory({ credentials, account = 'test-user', failRead = null }) {
  const calls = [];
  const execFileSync = (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'find-generic-password' && args.includes('-w')) {
      if (failRead) throw failRead;
      return `${JSON.stringify(credentials)}\n`;
    }
    if (args[0] === 'find-generic-password') {
      return `    "acct"<blob>="${account}"\n`;
    }
    return '';
  };
  return { calls, execFileSync };
}

test('macOS keychain credentials are read, backed up, and updated safely', () => {
  const dir = tempDir();
  const credentialsPath = path.join(dir, '.credentials.json');
  const backupDir = path.join(dir, 'backups');
  const current = {
    claudeAiOauth: { accessToken: 'old' },
    mcpOAuth: { provider: 'must-survive' },
  };
  const keychain = keychainExecFactory({ credentials: current });

  assert.deepStrictEqual(readCredentials(credentialsPath, {
    platform: 'darwin',
    execFileSync: keychain.execFileSync,
  }), current);

  writeCredentials(credentialsPath, {
    claudeAiOauth: { accessToken: 'new' },
  }, backupDir, {
    platform: 'darwin',
    execFileSync: keychain.execFileSync,
  });

  const writeCall = keychain.calls.find((call) => call.args[0] === 'add-generic-password');
  assert.ok(writeCall);
  const written = JSON.parse(writeCall.args[writeCall.args.indexOf('-w') + 1]);
  assert.strictEqual(written.claudeAiOauth.accessToken, 'new');
  assert.deepStrictEqual(written.mcpOAuth, current.mcpOAuth);
  assert.strictEqual(fs.readdirSync(backupDir).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('macOS keychain access failures stop before any write', () => {
  const dir = tempDir();
  const credentialsPath = path.join(dir, '.credentials.json');
  const backupDir = path.join(dir, 'backups');
  const error = Object.assign(new Error('access denied'), {
    status: 36,
    stderr: 'User interaction is not allowed.',
  });
  const keychain = keychainExecFactory({
    credentials: {},
    failRead: error,
  });

  assert.throws(() => writeCredentials(credentialsPath, {
    claudeAiOauth: { accessToken: 'new' },
  }, backupDir, {
    platform: 'darwin',
    execFileSync: keychain.execFileSync,
  }), /Failed to read macOS keychain credentials/);
  assert.strictEqual(keychain.calls.some((call) => call.args[0] === 'add-generic-password'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('verifyLiveState reads macOS keychain credentials', () => {
  const dir = tempDir();
  const configPath = path.join(dir, '.claude.json');
  const credentialsPath = path.join(dir, '.credentials.json');
  fs.writeFileSync(configPath, JSON.stringify({ oauthAccount: { accountUuid: 'uuid-a' } }), 'utf8');
  const keychain = keychainExecFactory({ credentials: { claudeAiOauth: { accessToken: 'token-a' } } });

  assert.deepStrictEqual(verifyLiveState({ configPath, credentialsPath }, {
    accountUuid: 'uuid-a',
    accessToken: 'token-a',
  }, {
    platform: 'darwin',
    execFileSync: keychain.execFileSync,
  }), { ok: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

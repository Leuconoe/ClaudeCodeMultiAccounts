const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acquireLock, releaseLock, withLock } = require('../lib/store/lock.cjs');

function tempLockPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-switch-lock-test-'));
  return { dir, lockPath: path.join(dir, 'switch.lock') };
}

test('lock: second acquisition is refused while the first is held', () => {
  const { dir, lockPath } = tempLockPath();
  const held = acquireLock({ lockPath, timeoutMs: 0 });

  assert.throws(() => acquireLock({ lockPath, timeoutMs: 0 }), /operation is in progress/);

  held.release();
  const second = acquireLock({ lockPath, timeoutMs: 0 });
  second.release();

  fs.rmSync(dir, { recursive: true, force: true });
});

test('lock: records the holder pid', () => {
  const { dir, lockPath } = tempLockPath();
  const held = acquireLock({ lockPath, timeoutMs: 0 });

  const holder = JSON.parse(fs.readFileSync(path.join(lockPath, 'holder.json'), 'utf8'));
  assert.strictEqual(holder.pid, process.pid);
  assert.ok(Number.isFinite(holder.acquiredAt));

  held.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lock: a stale lock is broken instead of blocking forever', () => {
  const { dir, lockPath } = tempLockPath();
  // Simulate a lock left behind by a killed process.
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(
    path.join(lockPath, 'holder.json'),
    JSON.stringify({ pid: 999999, acquiredAt: Date.now() - 120000 }),
    'utf8',
  );

  const held = acquireLock({ lockPath, timeoutMs: 0, staleMs: 60000 });
  const holder = JSON.parse(fs.readFileSync(path.join(lockPath, 'holder.json'), 'utf8'));
  assert.strictEqual(holder.pid, process.pid, 'the stale lock should be taken over');

  held.release();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lock: an unreadable holder file does not wedge the lock', () => {
  const { dir, lockPath } = tempLockPath();
  fs.mkdirSync(lockPath, { recursive: true });
  fs.writeFileSync(path.join(lockPath, 'holder.json'), 'not json', 'utf8');
  // Backdate the directory so the mtime fallback treats it as stale.
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lockPath, old, old);

  const held = acquireLock({ lockPath, timeoutMs: 0, staleMs: 60000 });
  held.release();

  fs.rmSync(dir, { recursive: true, force: true });
});

test('lock: withLock releases even when the body throws', async () => {
  const { dir, lockPath } = tempLockPath();

  await assert.rejects(
    withLock({ lockPath, timeoutMs: 0 }, async () => { throw new Error('boom'); }),
    /boom/,
  );
  assert.strictEqual(fs.existsSync(lockPath), false, 'the lock must not survive a thrown body');

  const after = acquireLock({ lockPath, timeoutMs: 0 });
  after.release();

  fs.rmSync(dir, { recursive: true, force: true });
});

test('lock: releaseLock is safe when nothing is held', () => {
  const { dir, lockPath } = tempLockPath();
  assert.doesNotThrow(() => releaseLock(lockPath));
  fs.rmSync(dir, { recursive: true, force: true });
});

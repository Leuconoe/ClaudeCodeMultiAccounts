const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_STALE_MS = 60000;
const POLL_INTERVAL_MS = 100;

function getDefaultLockPath() {
  return path.join(os.homedir(), '.claude', 'multi-account-switch', 'switch.lock');
}

function readHolder(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, 'holder.json'), 'utf8'));
  } catch {
    return null;
  }
}

function isStale(lockPath, staleMs, now) {
  const holder = readHolder(lockPath);
  if (!holder || typeof holder.acquiredAt !== 'number') {
    // Unreadable holder metadata: fall back to directory mtime.
    try {
      return now - fs.statSync(lockPath).mtimeMs > staleMs;
    } catch {
      return false;
    }
  }
  return now - holder.acquiredAt > staleMs;
}

function sleepSync(ms) {
  // Deliberately synchronous: the whole CLI is synchronous around file IO,
  // and Atomics.wait keeps the wait tight without a busy loop.
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function acquireLock(options = {}) {
  const lockPath = options.lockPath || getDefaultLockPath();
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const staleMs = options.staleMs === undefined ? DEFAULT_STALE_MS : options.staleMs;
  const deadline = Date.now() + timeoutMs;

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      // mkdir is atomic on both Windows and POSIX: the winner creates the dir.
      fs.mkdirSync(lockPath);
      fs.writeFileSync(
        path.join(lockPath, 'holder.json'),
        `${JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }, null, 2)}\n`,
        'utf8',
      );
      return { lockPath, release: () => releaseLock(lockPath) };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (isStale(lockPath, staleMs, Date.now())) {
        releaseLock(lockPath);
        continue;
      }
      if (Date.now() >= deadline) {
        const holder = readHolder(lockPath);
        const who = holder && holder.pid ? ` (held by pid ${holder.pid})` : '';
        throw new Error(`Another multi-account-switch operation is in progress${who}. Try again shortly.`);
      }
      sleepSync(POLL_INTERVAL_MS);
    }
  }
}

function releaseLock(lockPath) {
  try {
    fs.rmSync(lockPath, { recursive: true, force: true });
  } catch {
    // A failed release only risks a stale lock, which times out on its own.
  }
}

async function withLock(options, fn) {
  const handle = acquireLock(options);
  try {
    return await fn();
  } finally {
    handle.release();
  }
}

module.exports = { getDefaultLockPath, acquireLock, releaseLock, withLock, DEFAULT_STALE_MS };

const { spawn } = require('child_process');

const DEFAULT_POLL_MS = 5000;
const DEFAULT_MAX_WAIT_MS = 6 * 60 * 60 * 1000;

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering it.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// A staged switch is useless if the user must remember to come back and apply
// it, so a detached watcher applies it the moment the last session exits.
function spawnWatcher(deps) {
  const { cliPath, options, readSettings, writeSettings, ensureDir } = deps;
  const settings = readSettings();
  if (settings.watcher && isProcessAlive(settings.watcher.pid)) {
    return { spawned: false, reason: 'already running', pid: settings.watcher.pid };
  }

  const args = [cliPath, '--watch-apply'];
  for (const [flag, value] of [
    ['--config', options.configPath],
    ['--credentials', options.credentialsPath],
    ['--store', options.storePath],
    ['--backup-dir', options.backupDir],
    ['--usage-command', options.usageCommand],
  ]) {
    if (value) args.push(flag, value);
  }

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const next = readSettings();
  next.watcher = { pid: child.pid, startedAt: new Date().toISOString() };
  writeSettings(next, ensureDir);
  return { spawned: true, pid: child.pid };
}

function clearWatcherRecord(deps) {
  const { readSettings, writeSettings, ensureDir } = deps;
  const settings = readSettings();
  if (!settings.watcher) return;
  delete settings.watcher;
  writeSettings(settings, ensureDir);
}

// Returns why it stopped so both the real watcher and the tests can assert it.
async function runWatchLoop(deps) {
  const {
    detectClaudeSessions,
    readStaged,
    applyNow,
    sleep,
    now,
    pollMs = DEFAULT_POLL_MS,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
  } = deps;

  const startedAt = now();
  for (;;) {
    if (!readStaged()) return { outcome: 'cancelled' };
    if (now() - startedAt > maxWaitMs) return { outcome: 'timeout' };

    const sessions = detectClaudeSessions();
    if (sessions.detected && sessions.count === 0) {
      // Re-read inside the same tick: the user may have cancelled while we slept.
      if (!readStaged()) return { outcome: 'cancelled' };
      const applied = await applyNow();
      return { outcome: applied ? 'applied' : 'apply-failed' };
    }

    await sleep(pollMs);
  }
}

module.exports = {
  isProcessAlive,
  spawnWatcher,
  clearWatcherRecord,
  runWatchLoop,
  DEFAULT_POLL_MS,
  DEFAULT_MAX_WAIT_MS,
};

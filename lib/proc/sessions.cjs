const { execFileSync } = require('child_process');

// Best-effort: only the native `claude` executable is detectable by name.
// Detection failure must never block a switch.
function detectClaudeSessions() {
  // Escape hatch for tests and for setups where Claude Code runs under a
  // process name this check cannot see.
  const override = process.env.CC_SWITCH_SESSION_COUNT;
  if (override !== undefined && override !== '') {
    const count = Number.parseInt(override, 10);
    if (Number.isFinite(count) && count >= 0) return { detected: true, count, override: true };
  }
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', 'IMAGENAME eq claude.exe', '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      const count = output.split(/\r?\n/).filter((line) => line.trim().startsWith('"claude.exe"')).length;
      return { detected: true, count };
    }
    const output = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'comm='], { encoding: 'utf8', timeout: 5000 });
    const count = output.split(/\r?\n/).filter((line) => {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match || match[2].split('/').pop() !== 'claude') return false;
      try {
        const args = execFileSync('ps', ['-ww', '-p', match[1], '-o', 'args='], {
          encoding: 'utf8', timeout: 5000,
        }).trim();
        // Exclude only the browser helper launch mode, not text in a prompt.
        return ![match[2], 'claude'].some((executable) => (
          args.startsWith(executable)
          && /^\s+--chrome-native-host(?:\s|$)/.test(args.slice(executable.length))
        ));
      } catch {
        // Preserve the session guard if argument inspection fails.
        return true;
      }
    }).length;
    return { detected: true, count };
  } catch {
    return { detected: false, count: 0 };
  }
}

module.exports = { detectClaudeSessions };

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
        // argv[0]: macOS comm is the full path (may contain spaces); Linux comm is
        // only the basename, so fall back to a space-free path ending in claude.
        const executable = args.startsWith(match[2])
          ? match[2]
          : (args.match(/^(?:\S*\/)?claude(?=\s|$)/) || [''])[0];
        // Exclude only the browser helper launch mode, not text in a prompt.
        return !(executable && /^\s+--chrome-native-host(?:\s|$)/.test(args.slice(executable.length)));
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

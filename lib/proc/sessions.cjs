const { execFileSync } = require('child_process');

// Best-effort: only the native `claude` executable is detectable by name.
// Detection failure must never block a switch.
function detectClaudeSessions() {
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
    const output = execFileSync('ps', ['-A', '-o', 'comm='], { encoding: 'utf8', timeout: 5000 });
    const count = output.split(/\r?\n/).filter((line) => {
      const name = line.trim().split('/').pop();
      return name === 'claude';
    }).length;
    return { detected: true, count };
  } catch {
    return { detected: false, count: 0 };
  }
}

module.exports = { detectClaudeSessions };

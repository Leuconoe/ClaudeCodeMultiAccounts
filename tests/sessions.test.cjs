const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../lib/proc/sessions.cjs'), 'utf8');

function detect(rows, commands = {}, options = {}) {
  const calls = [];
  const context = {
    module: { exports: {} },
    process: { platform: options.platform || 'darwin', env: options.env || {} },
    require: (name) => {
      assert.strictEqual(name, 'child_process');
      return {
        execFileSync: (command, args) => {
          calls.push({ command, args: Array.from(args) });
          if (rows instanceof Error) throw rows;
          if (command === 'tasklist' || args[0] === '-A') return rows;
          assert.strictEqual(command, 'ps');
          assert.deepStrictEqual(Array.from(args), ['-ww', '-p', args[2], '-o', 'args=']);
          const result = commands[args[2]];
          if (result instanceof Error) throw result;
          assert.strictEqual(typeof result, 'string');
          return result;
        },
      };
    },
  };
  vm.runInNewContext(source, context);
  return { ...context.module.exports.detectClaudeSessions(), calls };
}

for (const platform of ['darwin', 'linux']) {
  test(`${platform}: browser helper alone is not a session`, () => {
    const result = detect('  123 /Users/example/.local/bin/claude\n', {
      123: '/Users/example/.local/bin/claude --chrome-native-host\n',
    }, { platform });
    assert.strictEqual(result.detected, true);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.calls[0].args, ['-A', '-o', 'pid=', '-o', 'comm=']);
  });
}

test('browser helper does not hide a real session', () => {
  const result = detect('1 /bin/claude\n2 /bin/claude\n3 /Applications/Claude\n4 /bin/node\n', {
    1: '/bin/claude --chrome-native-host',
    2: '/bin/claude --resume',
  });
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.calls.length, 3);
});

test('bare executable name and paths containing spaces support the helper mode', () => {
  assert.strictEqual(detect('1 /opt/Claude Code/claude\n', {
    1: '/opt/Claude Code/claude --chrome-native-host',
  }).count, 0);
  assert.strictEqual(detect('1 /bin/claude\n', {
    1: 'claude --chrome-native-host',
  }).count, 0);
});

test('helper command appearing in prompt text is still a session', () => {
  for (const args of [
    '/bin/claude -p "explain --chrome-native-host"',
    '/bin/claude -p "explain /bin/claude --chrome-native-host"',
    '/bin/claude --chrome-native-host-other',
    '/bin/claude',
  ]) {
    assert.strictEqual(detect('1 /bin/claude\n', { 1: args }).count, 1, args);
  }
});

test('argument inspection failure or empty output preserves the guard', () => {
  for (const result of [new Error('process unavailable'), '']) {
    const actual = detect('1 /bin/claude\n', { 1: result });
    assert.strictEqual(actual.detected, true);
    assert.strictEqual(actual.count, 1);
  }
});

test('empty process list contains no sessions', () => {
  assert.strictEqual(detect('').count, 0);
});

test('process listing failure retains best-effort behavior', () => {
  const result = detect(new Error('ps unavailable'));
  assert.strictEqual(result.detected, false);
  assert.strictEqual(result.count, 0);
});

test('session count override bypasses process inspection', () => {
  const result = detect('', {}, { env: { CC_SWITCH_SESSION_COUNT: '2' } });
  assert.strictEqual(result.count, 2);
  assert.strictEqual(result.override, true);
  assert.strictEqual(result.calls.length, 0);
});

test('Windows tasklist detection is unchanged', () => {
  const result = detect('"claude.exe","123"\r\n"node.exe","456"\r\n', {}, { platform: 'win32' });
  assert.strictEqual(result.detected, true);
  assert.strictEqual(result.count, 1);
  assert.strictEqual(result.calls[0].command, 'tasklist');
});

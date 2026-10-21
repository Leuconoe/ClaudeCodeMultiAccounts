const test = require('node:test');
const assert = require('node:assert');
const { getEffectiveWindows } = require('../lib/usage/format.cjs');

const NOW = Date.parse('2026-10-21T09:00:00Z');
const past = '2026-10-21T08:00:00Z';
const future = '2026-10-21T12:00:00Z';

test('getEffectiveWindows: windows past their reset read as rolled over', () => {
  const { fiveHour, sevenDay } = getEffectiveWindows({
    five_hour: { utilization: 99, resets_at: past },
    seven_day: { utilization: 32, resets_at: past },
  }, NOW);
  assert.strictEqual(fiveHour.utilization, 0);
  assert.strictEqual(sevenDay.utilization, 0);
});

test('getEffectiveWindows: an exhausted 7d window blocks the 5h window', () => {
  const { fiveHour, sevenDay } = getEffectiveWindows({
    five_hour: { utilization: 49, resets_at: past },
    seven_day: { utilization: 100, resets_at: future },
  }, NOW);
  assert.strictEqual(fiveHour.utilization, 100);
  assert.strictEqual(fiveHour.resets_at, future);
  assert.strictEqual(sevenDay.utilization, 100);
});

test('getEffectiveWindows: live windows pass through', () => {
  const usage = {
    five_hour: { utilization: 2, resets_at: future },
    seven_day: { utilization: 40, resets_at: future },
  };
  const { fiveHour, sevenDay } = getEffectiveWindows(usage, NOW);
  assert.strictEqual(fiveHour, usage.five_hour);
  assert.strictEqual(sevenDay, usage.seven_day);
  assert.deepStrictEqual(getEffectiveWindows(undefined, NOW), { fiveHour: undefined, sevenDay: undefined });
});

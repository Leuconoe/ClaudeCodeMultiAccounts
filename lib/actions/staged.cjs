// A staged switch records the intent to switch without touching live files.
// It exists because a running Claude Code session rewrites ~/.claude.json
// wholesale and would revert an immediate swap.
function readStagedSwitch(settings) {
  const staged = settings && settings.stagedSwitch;
  if (!staged || typeof staged !== 'object') return null;
  if (!staged.key) return null;
  return staged;
}

function buildStagedSwitch(selected, now) {
  return {
    key: selected.key,
    emailAddress: selected.metadata && selected.metadata.emailAddress,
    stagedAt: new Date(now).toISOString(),
  };
}

function stageSwitch(selected, deps) {
  const { readSettings, writeSettings, ensureDir, now } = deps;
  const settings = readSettings();
  settings.stagedSwitch = buildStagedSwitch(selected, now());
  writeSettings(settings, ensureDir);
  return settings.stagedSwitch;
}

function clearStagedSwitch(deps) {
  const { readSettings, writeSettings, ensureDir } = deps;
  const settings = readSettings();
  if (!settings.stagedSwitch) return null;
  const previous = settings.stagedSwitch;
  delete settings.stagedSwitch;
  writeSettings(settings, ensureDir);
  return previous;
}

// Resolves a staged record against the current store; the slot may have been
// removed or re-indexed since staging.
function resolveStagedSelection(staged, accounts) {
  if (!staged) return null;
  return accounts.find((entry) => entry.key === staged.key) || null;
}

module.exports = {
  readStagedSwitch,
  buildStagedSwitch,
  stageSwitch,
  clearStagedSwitch,
  resolveStagedSelection,
};

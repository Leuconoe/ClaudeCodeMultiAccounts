#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function getInstallRoot() {
  return path.join(os.homedir(), '.claude', 'multi-account-switch');
}

function getStatuslineTargetPath() {
  return path.join(getInstallRoot(), 'hooks', 'statusline-target.json');
}

function readJsonIfExists(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getStatuslineLabel() {
  return 'use !cc-switch / !ccs';
}

function runDownstream(input) {
  const target = readJsonIfExists(getStatuslineTargetPath(), null);
  if (!target || target.type !== 'command' || !target.command) {
    return '';
  }

  const result = spawnSync(target.command, {
    input,
    encoding: 'utf8',
    shell: true,
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    return '';
  }

  return (result.stdout || '').trimEnd();
}

function prependLabel(label, downstream) {
  if (!downstream) {
    return label;
  }

  const lines = downstream.split(/\r?\n/);
  lines[0] = lines[0] ? `${label} │ ${lines[0]}` : label;
  return lines.join('\n');
}

const stdin = fs.readFileSync(0, 'utf8');
const label = getStatuslineLabel();
const downstream = runDownstream(stdin);
process.stdout.write(`${prependLabel(label, downstream)}\n`);

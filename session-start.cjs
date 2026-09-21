#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '..', 'bin', 'cc-switch.cjs');
spawnSync('node', [cliPath, '--touch-current'], { stdio: 'ignore' });

console.log('Claude Code Multi-Account Switcher: run !ccs to list/switch accounts, !ccso to sync the active account.');

#!/usr/bin/env node
/**
 * Cross-platform first-time setup: Python deps + root npm + server npm.
 * Usage: node scripts/bootstrap.mjs   or   npm run bootstrap
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(label, command, args, cwd = root) {
  console.log(`\n→ ${label}`);
  const r = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (r.status !== 0 && r.status !== null) {
    console.error(`\nBootstrap failed at: ${label}`);
    process.exit(r.status);
  }
}

const pipCandidates = [
  ['python3', ['-m', 'pip', 'install', '-r', 'server/python/requirements.txt']],
  ['python', ['-m', 'pip', 'install', '-r', 'server/python/requirements.txt']],
];

let pipOk = false;
for (const [cmd, args] of pipCandidates) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status === 0) {
    pipOk = true;
    break;
  }
}
if (!pipOk) {
  console.error('\nCould not run pip. Install Python 3 and ensure `python3 -m pip` works.');
  process.exit(1);
}

run('npm install (root)', 'npm', ['install'], root);
run('npm install (server)', 'npm', ['install'], path.join(root, 'server'));

console.log('\n✓ Bootstrap complete. Start everything with: npm run start:all\n');

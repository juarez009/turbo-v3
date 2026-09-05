import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
}
for (const file of ['scripts','tests','supabase/functions'].flatMap(walk).filter(file => file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('JavaScript syntax OK');

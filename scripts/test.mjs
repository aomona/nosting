import {readdirSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
mkdirSync('.sites-runtime', {recursive: true});
const tests = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort();
let failed = 0;
// Tests use shared temporary filenames; keep execution sequential.
for (const test of tests) {
  console.log(`\n--- ${test} ---`);
  const result = spawnSync(process.execPath, [`tests/${test}`], {stdio: 'inherit'});
  if (result.error || result.status !== 0) {failed++; console.error(result.error ?? `Exit ${result.status}`);}
}
console.log(`\n${tests.length - failed}/${tests.length} test files passed`);
process.exitCode = failed ? 1 : 0;

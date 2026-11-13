import {spawnSync} from 'node:child_process';
import {existsSync, chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.CI && process.env.PETAL_SKIP_HOOKS !== '1' && existsSync(new URL('../.git', import.meta.url))) {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], {cwd: root, encoding: 'utf8'});
  const current = configured.stdout?.trim();
  const oldHook = spawnSync('git', ['rev-parse', '--git-path', 'hooks/pre-commit'], {cwd: root, encoding: 'utf8'}).stdout?.trim();
  if ((current && current !== '.githooks') || (!current && oldHook && existsSync(path.resolve(root, oldHook)))) {
    console.warn('Existing Git hooks preserved. Add npm run precommit to your pre-commit hook.');
  } else {
    chmodSync(new URL('../.githooks/pre-commit', import.meta.url), 0o755);
    const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {cwd: root, stdio: 'inherit'});
    if (result.error || result.status !== 0) process.exitCode = 1;
  }
}

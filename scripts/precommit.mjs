import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

// Export only the index: unstaged fixes and untracked files must not hide a broken commit.
// No stash/reset, and no developer secrets or generated files are copied.
export function withStagedSnapshot(root, check) {
  const snapshot = mkdtempSync(path.join(tmpdir(), 'petal-precommit-'));
  try {
    run('git', ['checkout-index', '--all', '--force', `--prefix=${snapshot}${path.sep}`], {cwd: root});
    return check(snapshot);
  } finally {
    rmSync(snapshot, {recursive: true, force: true});
  }
}

export function main() {
  if (!process.env.npm_execpath) throw new Error('Run npm run precommit.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  withStagedSnapshot(root, cwd => {
    const env = {...process.env, PETAL_SKIP_HOOKS: '1'};
    // Git hook variables must not leak into nested test repositories.
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR']) delete env[key];
    // Match CI, including the lockfile and optional native dependencies. npm's cache is reused.
    run(process.execPath, [process.env.npm_execpath, 'ci', '--no-audit', '--no-fund'], {cwd, env});
    run(process.execPath, [process.env.npm_execpath, 'run', 'check'], {cwd, env});
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(`\nCommit blocked: ${error.message}\nFix and stage the complete change, then retry.`);
    process.exitCode = 1;
  }
}

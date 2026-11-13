import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {withStagedSnapshot} from '../scripts/precommit.mjs';
const root = mkdtempSync(path.join(tmpdir(), 'petal-hook-test-'));
const git = (...args) => execFileSync('git', args, {cwd: root, stdio: 'pipe'});
let snapshot;
try {
  git('init');
  writeFileSync(path.join(root, 'source.txt'), 'staged');
  git('add', 'source.txt');
  writeFileSync(path.join(root, 'source.txt'), 'unstaged');
  writeFileSync(path.join(root, 'missing.css'), 'not added');
  writeFileSync(path.join(root, '.env.local'), 'not for export');
  withStagedSnapshot(root, dir => {
    snapshot = dir;
    assert.equal(readFileSync(path.join(dir, 'source.txt'), 'utf8'), 'staged');
    assert.equal(existsSync(path.join(dir, 'missing.css')), false);
    assert.equal(existsSync(path.join(dir, '.env.local')), false);
  });
  assert.equal(existsSync(snapshot), false);
  assert.throws(() => withStagedSnapshot(root, dir => {snapshot = dir; throw Error('check failed');}), /check failed/);
  assert.equal(existsSync(snapshot), false);
  assert.equal(readFileSync(path.join(root, 'source.txt'), 'utf8'), 'unstaged');
  assert.equal(git('show', ':source.txt').toString(), 'staged');
  git('rm', '--cached', '-f', 'source.txt');
  withStagedSnapshot(root, dir => assert.equal(existsSync(path.join(dir, 'source.txt')), false));
  console.log('PASS precommit snapshot: index only, excludes untracked/secrets, cleanup on failure, preserves working tree/index, staged deletion');
} finally {rmSync(root, {recursive: true, force: true});}

import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = mkdtempSync(path.join(tmpdir(), 'petal-install-test-'));
const env = {...process.env, CI: '', PETAL_SKIP_HOOKS: '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global')};
const git = (...args) => spawnSync('git', args, {cwd: root, env, encoding:'utf8'});
const install = () => {const r=spawnSync(process.execPath,['scripts/install-hooks.mjs'],{cwd:root,env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
try {
  mkdirSync(path.join(root,'scripts'));mkdirSync(path.join(root,'.githooks'));
  copyFileSync('scripts/install-hooks.mjs',path.join(root,'scripts/install-hooks.mjs'));
  writeFileSync(path.join(root,'.githooks/pre-commit'),'#!/bin/sh\nexit 0\n');
  install(); // source archive: no .git, no action
  git('init');
  env.CI='true';install();assert.equal(git('config','--get','core.hooksPath').status,1);
  env.CI='';env.PETAL_SKIP_HOOKS='1';install();assert.equal(git('config','--get','core.hooksPath').status,1);
  env.PETAL_SKIP_HOOKS='';install();assert.equal(git('config','--get','core.hooksPath').stdout.trim(),'.githooks');
  git('config','core.hooksPath','custom-hooks');install();assert.equal(git('config','--get','core.hooksPath').stdout.trim(),'custom-hooks');
  git('config','--unset','core.hooksPath');writeFileSync(path.join(root,'.git/hooks/pre-commit'),'existing');
  install();assert.equal(git('config','--get','core.hooksPath').status,1);
  console.log('PASS hooks install: source archive, CI and explicit skip, fresh install, custom path and existing hook preserved');
} finally {rmSync(root,{recursive:true,force:true});}

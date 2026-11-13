import {readFile, writeFile} from 'node:fs/promises';
const [databaseId, bucketName, workerName = 'petal'] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(databaseId ?? '') || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName ?? '') || !/^[a-z0-9-]+$/.test(workerName)) {
  throw new Error('Usage: node scripts/prepare-self-host.mjs <D1 database UUID> <R2 bucket name> [worker name]');
}
// Keep Vinext's emitted runtime settings instead of duplicating its build contract.
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
config.name = workerName;
config.main = 'dist/server/index.js';
config.assets = {...config.assets, directory: 'dist/client'};
config.d1_databases = [{binding: 'DB', database_name: 'petal', database_id: databaseId, migrations_dir: 'drizzle'}];
config.r2_buckets = [{binding: 'BUCKET', bucket_name: bucketName}];
config.services = [];
await writeFile('wrangler.self-host.json', JSON.stringify(config, null, 2) + '\n', {flag: 'wx'});
console.log('Created wrangler.self-host.json. Review it before applying migrations or deploying.');

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const config = JSON.parse(await read('firebase.json'));
assert.equal(config.hosting.public, 'dist');
assert.equal(config.hosting.site, 'trywise-9f8e1');
assert(config.hosting.predeploy.includes('npm run build'));
const manifest = JSON.parse(await read('dist/release.json'));
assert.equal(manifest.commit, execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim());
const expected = ['index.html', 'firebase-config.js', 'firebase-client.mjs', 'plan-state.mjs', 'plan-store.mjs', 'account-ui.mjs', 'assets/trywise-mark.svg', 'seed-catalog.mjs', 'catalog-model.mjs', 'catalog-client.mjs', 'admin.html', 'admin.css', 'admin-ui.mjs', 'offer-identity.mjs', 'starter-audit.mjs', 'consumer-model.mjs', 'catalog-policy.mjs'];
assert.deepEqual(Object.keys(manifest.files).sort(), expected.sort());
for (const file of expected) {
  assert.equal(createHash('sha256').update(await read(`dist/${file}`)).digest('hex'), manifest.files[file]);
}
const files = await readdir(new URL('dist/', root), { recursive: true, withFileTypes: true });
assert.equal(files.filter(v => v.isFile()).length, expected.length + 1);
const html = await read('dist/index.html');
assert(html.includes('./plan-state.mjs') && html.includes('./account-ui.mjs'));
assert(!html.includes('loadGeneratedCatalog'), 'Raw scraped data must not bypass the approval pipeline');
assert(!html.includes('backend/data/'), 'Private collector artifacts must not be consumed by the public app');
const model = await import('../catalog-model.mjs');
const seeds = (await import('../seed-catalog.mjs')).seedCatalog;
const first = model.mergedCatalog(seeds, []);
assert.deepEqual(model.mergedCatalog(seeds, []), first, 'Unchanged options must survive repeated catalog snapshots');
console.log('Release build checks passed: allowlist, exact hashes, account/admin assets, no raw collector publication.');

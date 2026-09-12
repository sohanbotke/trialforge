import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const files = ['index.html', 'firebase-config.js', 'firebase-client.mjs', 'plan-state.mjs', 'plan-store.mjs', 'account-ui.mjs', 'assets/trywise-mark.svg', 'seed-catalog.mjs', 'catalog-model.mjs', 'catalog-client.mjs', 'admin.html', 'admin.css', 'admin-ui.mjs', 'offer-identity.mjs', 'starter-audit.mjs', 'consumer-model.mjs'];
await mkdir(path.join(output, 'assets'), { recursive: true });
// Fail closed if an unexpected file was left in the deployment directory.
for (const item of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!item.isFile()) continue;
  const relative = path.relative(output, path.join(item.parentPath, item.name));
  if (!files.includes(relative)) throw new Error(`Unexpected deployment file: ${relative}. Review it before deploying.`);
}
for (const file of files) await copyFile(path.join(root, file), path.join(output, file));
console.log(`Prepared ${files.length} website files in dist/.`);

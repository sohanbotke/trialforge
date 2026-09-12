import { randomUUID } from 'node:crypto';
import { firebaseConfig } from '../firebase-config.js';
import { readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const project = 'trywise-9f8e1';
export const accountEmail = `trywise-nightly@${project}.iam.gserviceaccount.com`;
export const credentialPath = resolve(homedir(), 'Library/Application Support/TryWise/nightly-session.json');
const root = dirname(fileURLToPath(import.meta.url));
const outboxPath = resolve(root, 'data/nightly/outbox.json');

async function atomicJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

export function validateRecord(path, data) {
  if (!/^(candidates\/[a-f0-9]{64}|crawlRuns\/[0-9]{8}T[0-9]{6}-[a-f0-9]{8})$/.test(path)) throw new Error('Refusing upload outside the review queue.');
  if (!data || data.schemaVersion !== 1 || path.split('/')[1] !== data.id || !Number.isFinite(Date.parse(data.observedAt))) throw new Error('Invalid review record envelope.');
  if (Buffer.byteLength(JSON.stringify(data)) > 30000) throw new Error('Review record exceeds size limit.');
  if (path.startsWith('candidates/')) {
    if (data.status !== 'pending_review' || data.verificationStatus !== 'unverified') throw new Error('Collector cannot approve offers.');
    if (!Array.isArray(data.evidence) || data.evidence.length > 6 || data.evidence.some(v => typeof v !== 'string' || v.length > 500)) throw new Error('Invalid evidence excerpts.');
    for (const key of ['url', 'sourceUrl', 'evidenceUrl', 'policyUrl']) {
      const url = new URL(data[key]);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid source URL.');
    }
  }
}

export function firestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Number.isSafeInteger(value)) return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  throw new Error('Unsupported Firestore value.');
}

export async function accessToken() {
  const stat = await lstat(credentialPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid()) throw new Error('Collector credential must be an owner-only regular file.');
  const session = JSON.parse(await readFile(credentialPath, 'utf8'));
  if (session.type !== 'firebase_collector' || session.project_id !== project || session.uid !== 'trywise-nightly-collector') throw new Error('Wrong collector session.');
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refresh_token }) });
  if (!response.ok) throw new Error(`Collector session refresh failed (${response.status}); no credentials logged.`);
  const result = await response.json();
  const claims = JSON.parse(Buffer.from(result.id_token.split('.')[1], 'base64url').toString());
  if (claims.sub !== session.uid || claims.aud !== project || claims.collector !== true || claims.firebase?.sign_in_provider !== 'custom') throw new Error('Refreshed collector identity or claims do not match.');
  if (result.refresh_token && result.refresh_token !== session.refresh_token) await atomicJSON(credentialPath, { ...session, refresh_token: result.refresh_token });
  return result.id_token;
}

export async function createRecord(token, path, data) {
  validateRecord(path, data);
  const [collection, id] = path.split('/');
  const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${collection}?documentId=${id}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const envelope = { id: data.id, schemaVersion: 1, status: data.status, observedAt: data.observedAt, payloadJson: JSON.stringify(data) };
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(firestoreValue(envelope).mapValue) });
    if (response.ok) return 'created';
    const error = await response.json().catch(() => ({}));
    if (response.status === 409 && error.error?.status === 'ALREADY_EXISTS') return 'already_exists';
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`Review upload failed (${response.status}, ${error.error?.status || 'unknown'}). Outbox retained.`);
  }
}

async function main() {
  if (resolve(process.argv[2] || outboxPath) !== outboxPath) throw new Error('Only the local collector outbox can be uploaded.');
  const pending = JSON.parse(await readFile(outboxPath, 'utf8'));
  const entries = Object.entries(pending);
  for (const [path, data] of entries) validateRecord(path, data);
  if (!entries.length) return;
  const token = await accessToken();
  let uploaded = 0;
  for (const [path, data] of entries.slice(0, 100)) {
    await createRecord(token, path, data);
    delete pending[path];
    await atomicJSON(outboxPath, pending);
    uploaded++;
  }
  console.log(`Review records acknowledged: ${uploaded}; pending locally: ${Object.keys(pending).length}. No catalog or user-plan updates.`);
  if (Object.keys(pending).length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

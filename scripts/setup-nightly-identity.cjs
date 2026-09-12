// One-time operator setup only. The scheduled collector NEVER uses CLI credentials.
// Pass the installed firebase-tools directory in FIREBASE_TOOLS_DIR.
const { mkdir, writeFile, lstat, readFile } = require('node:fs/promises');
const { homedir } = require('node:os');
const { resolve, dirname } = require('node:path');
const project = 'trywise-9f8e1';
const email = `trywise-nightly@${project}.iam.gserviceaccount.com`;
const roleName = `projects/${project}/roles/trywiseCollectorCreateOnly`;
const credentials = resolve(homedir(), 'Library/Application Support/TryWise/nightly-collector.json');

async function main() {
  if (process.argv.includes('--apply')) throw new Error('Legacy IAM setup is retired. The collector now uses nightly-session.json and collection-scoped Firebase rules; do not recreate project-wide access.');
  const base = process.env.FIREBASE_TOOLS_DIR;
  if (!base) throw new Error('Set FIREBASE_TOOLS_DIR to the installed firebase-tools package directory.');
  const { requireAuth } = require(resolve(base, 'lib/requireAuth.js'));
  const { getGlobalDefaultAccount, setActiveAccount } = require(resolve(base, 'lib/auth.js'));
  const { getAccessToken } = require(resolve(base, 'lib/apiv2.js'));
  const options = { project, nonInteractive: true };
  const account = getGlobalDefaultAccount();
  if (!account) throw new Error('Sign in with the Firebase CLI first.');
  setActiveAccount(options, account);
  await requireAuth(options);
  const token = await getAccessToken();
  async function api(host, path, method = 'GET', body, missing = false) {
    const response = await fetch(`https://${host}/${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(`Setup API failed (${response.status}): ${data.error?.message || 'unknown'}`);
    }
    return response.json(); // Never log API bodies: a key response is sensitive.
  }
  const iam = 'iam.googleapis.com';
  const crm = 'cloudresourcemanager.googleapis.com';
  let identity = await api(iam, `v1/projects/${project}/serviceAccounts/${email}`, 'GET', null, true);
  let role = await api(iam, `v1/${roleName}`, 'GET', null, true);
  let policy = await api(crm, `v1/projects/${project}:getIamPolicy`, 'POST', { options: { requestedPolicyVersion: 3 } });
  const permissions = ['datastore.entities.create'];
  if (role && JSON.stringify([...role.includedPermissions].sort()) !== JSON.stringify(permissions)) throw new Error('Existing collector role differs; refusing to alter it.');
  const bindings = (policy.bindings || []).filter(b => b.members?.includes(`serviceAccount:${email}`));
  if (bindings.some(b => b.role !== roleName)) throw new Error('Collector already has other roles; review before proceeding.');
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ project, serviceAccountExists: !!identity, roleExists: !!role, existingBindings: bindings.map(b => b.role), requestedPermissions: permissions }));
    return;
  }
  if (!identity) identity = await api(iam, `v1/projects/${project}/serviceAccounts`, 'POST', { accountId: 'trywise-nightly', serviceAccount: { displayName: 'TryWise nightly review collector', description: 'Local Mac collector. Create-only review records; no document read, update, or delete permissions.' } });
  if (!role) role = await api(iam, `v1/projects/${project}/roles`, 'POST', { roleId: 'trywiseCollectorCreateOnly', role: { title: 'TryWise collector create only', description: 'Append-only Firestore documents. No reads, updates, deletes, or IAM administration.', includedPermissions: permissions, stage: 'GA' } });
  if (!bindings.some(b => b.role === roleName && !b.condition)) {
    policy.bindings ||= [];
    let binding = policy.bindings.find(b => b.role === roleName && !b.condition);
    if (!binding) policy.bindings.push(binding = { role: roleName, members: [] });
    binding.members.push(`serviceAccount:${email}`);
    await api(crm, `v1/projects/${project}:setIamPolicy`, 'POST', { policy }); // Preserve etag and every existing binding.
  }
  await mkdir(dirname(credentials), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(credentials));
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) throw new Error('Credential directory must be private (0700).');
  const existing = await lstat(credentials).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o077)) throw new Error('Existing credential permissions are unsafe.');
    const saved = JSON.parse(await readFile(credentials, 'utf8'));
    if (saved.client_email !== email || saved.project_id !== project) throw new Error('Existing credentials belong to a different identity.');
  } else {
    const keys = await api(iam, `v1/projects/${project}/serviceAccounts/${email}/keys?keyTypes=USER_MANAGED`);
    if (keys.keys?.length) throw new Error('A managed key already exists but the local credential is missing; review before creating another.');
    const key = await api(iam, `v1/projects/${project}/serviceAccounts/${email}/keys`, 'POST', { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE', keyAlgorithm: 'KEY_ALG_RSA_2048' });
    await writeFile(credentials, Buffer.from(key.privateKeyData, 'base64'), { mode: 0o600, flag: 'wx' });
  }
  console.log('Dedicated create-only collector identity configured. Credential stored outside the repository with owner-only permissions. No billing change.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

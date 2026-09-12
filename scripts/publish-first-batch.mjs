// One-time operator publication authorized by the owner on 2026-09-08.
// Uses existing CLI IAM access, never the collector credential or relaxed rules.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOffer } from '../catalog-model.mjs';

export const firstBatch = [
  {
    candidateId: '95f27e97d68ae6c22a2b7684ab8dd5679e2db7d414b0f221354b2b7d0d5d7863',
    sourceId: 'github-copilot-plans',
    offer: {
      id: 'github-copilot', name: 'GitHub Copilot Free', category: 'devtools',
      description: 'Try AI coding assistance with limited access to Copilot features on the individual Free plan.',
      url: 'https://docs.github.com/en/copilot/get-started/plans',
      offerType: 'free_tier', trialDays: 0, reviewDays: 14, monthlyValue: 0, upfrontCost: 0, currency: 'USD',
      priceDetails: '$0 for Copilot Free, with limited features and an AI-credit allowance. Paid Copilot plans are separate subscriptions; check current terms before upgrading.',
      eligibility: 'Individual developers without Copilot access through an organization or enterprise; requires a GitHub account. This is not Copilot Student or a Pro trial.',
      region: 'Subject to GitHub regional availability and account eligibility; confirm at signup.',
      cancellation: 'No paid subscription to cancel for this Free listing. If you choose a paid plan, review its separate billing and cancellation terms.',
      goal: 'Evaluate coding assistance on a small project within the free allowance.', expiresAt: null
    }
  },
  {
    candidateId: 'b4de6fb651993ca885299a9684f5b80a0f99daf7474933c4bfcdb6a8aaee0e7e',
    sourceId: 'cloudflare-workers-pricing',
    offer: {
      id: 'cloudflare-workers', name: 'Cloudflare Workers Free', category: 'cloudinfra',
      description: 'Deploy a small serverless application on the Workers Free plan within its usage limits.',
      url: 'https://developers.cloudflare.com/workers/platform/pricing/',
      offerType: 'free_tier', trialDays: 0, reviewDays: 14, monthlyValue: 0, upfrontCost: 0, currency: 'USD',
      priceDetails: '$0 base cost on Workers Free: 100,000 requests per day and 10 ms CPU time per invocation. Paid upgrades and other Cloudflare products have separate pricing and limits.',
      eligibility: 'Cloudflare account using Workers Free; usage must remain within the applicable free-plan limits.',
      region: 'Subject to Cloudflare regional availability and account eligibility; confirm at signup.',
      cancellation: 'No paid Workers subscription to cancel on Free. Paid upgrades and separately purchased services require their own billing review.',
      goal: 'Deploy a small API and check usage against the free-plan limits.', expiresAt: null
    }
  }
];

export function buildWrites(root) {
  return firstBatch.flatMap(({ candidateId, offer }) => {
    const data = validateOffer(offer);
    const review = { candidateId, status: 'approved', publishedId: data.id,
      notes: `One-time first-batch approval requested by owner on 2026-09-08; official source checked by assistant: ${data.url} . Published only the Free plan. Regional availability must be confirmed at signup; no provider expiry stated. Operator used existing CLI IAM authorization; no browser sign-in or human terms-checkbox completion is claimed.`,
      reviewedBy: 'operator:sohan2405@gmail.com', revision: 1, schemaVersion: 1 };
    return [
      { update: { name: `${root}/catalog/${data.id}`, fields: fields({ ...data, sourceCandidate: candidateId, status: 'published', revision: 1, schemaVersion: 1 }) }, currentDocument: { exists: false }, updateTransforms: ['verifiedAt', 'updatedAt'].map(serverTime) },
      { update: { name: `${root}/candidateReviews/${candidateId}`, fields: fields(review) }, currentDocument: { exists: false }, updateTransforms: ['reviewedAt'].map(serverTime) }
    ];
  });
}
const serverTime = fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' });
function fields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, value === null ? { nullValue: null } : typeof value === 'number' ? Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value } : { stringValue: value }]));
}
function decode(doc) {
  return Object.fromEntries(Object.entries(doc.fields || {}).map(([key, value]) => [key, value.stringValue ?? value.timestampValue ?? (value.integerValue !== undefined ? Number(value.integerValue) : value.nullValue)]));
}
async function main() {
  const apply = process.argv.includes('--apply');
  if (process.argv.slice(2).some(arg => !['--apply', '--inspect'].includes(arg))) throw new Error('Use --inspect or --apply.');
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (apply && localDate !== '2026-09-08') throw new Error('One-time approval window expired; review sources again.');
  const project = 'trywise-9f8e1', root = `projects/${project}/databases/(default)/documents`;
  const base = process.env.FIREBASE_TOOLS_DIR;
  if (!base) throw new Error('Set FIREBASE_TOOLS_DIR to the installed Firebase CLI directory.');
  const require = createRequire(import.meta.url);
  const auth = require(resolve(base, 'lib/auth.js'));
  const account = auth.getGlobalDefaultAccount();
  if (account?.user?.email !== 'sohan2405@gmail.com') throw new Error('Expected the existing owner CLI login.');
  const options = { project, nonInteractive: true };
  auth.setActiveAccount(options, account);
  await require(resolve(base, 'lib/requireAuth.js')).requireAuth(options);
  const token = await require(resolve(base, 'lib/apiv2.js')).getAccessToken();
  async function api(suffix, body) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${root}${suffix}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`Firestore ${suffix} failed (${response.status}); no automatic retry.`);
    return response.json();
  }
  const { transaction } = await api(':beginTransaction', { options: { readWrite: {} } });
  let committed = false;
  try {
    const documents = firstBatch.flatMap(({ candidateId, offer }) => [`${root}/candidates/${candidateId}`, `${root}/candidateReviews/${candidateId}`, `${root}/catalog/${offer.id}`]);
    const snapshots = await api(':batchGet', { documents, transaction });
    const found = new Map(snapshots.filter(row => row.found).map(row => [row.found.name, row.found]));
    for (const item of firstBatch) {
      const candidate = found.get(`${root}/candidates/${item.candidateId}`);
      if (!candidate) throw new Error(`Candidate missing: ${item.sourceId}`);
      const envelope = decode(candidate), payload = envelope.payloadJson ? JSON.parse(envelope.payloadJson) : envelope;
      if (payload.sourceId !== item.sourceId || payload.status !== 'pending_review') throw new Error(`Unexpected candidate: ${item.sourceId}`);
      const review = found.get(`${root}/candidateReviews/${item.candidateId}`), offer = found.get(`${root}/catalog/${item.offer.id}`);
      console.log(JSON.stringify({ id: item.offer.id, candidateId: item.candidateId, existingReview: review ? decode(review).status : null, existingCatalog: offer ? decode(offer).status : null }));
      if (apply && (review || offer)) throw new Error('An existing decision or catalog record would be overwritten; stopped.');
    }
    const writes = buildWrites(root);
    if (!apply) { console.log('Inspection complete; no publication performed.'); return; }
    const result = await api(':commit', { transaction, writes });
    committed = true;
    console.log(JSON.stringify({ published: firstBatch.map(item => item.offer.name), documentWrites: result.writeResults.length, commitTime: result.commitTime }));
  } finally {
    if (!committed) await api(':rollback', { transaction }).catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, deleteField } from 'firebase/firestore';
import { defaultState } from '../plan-state.mjs';

const env = await initializeTestEnvironment({ projectId: 'demo-trywise', firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const payload = (revision = 1) => ({ schemaVersion: 1, revision, stateJson: JSON.stringify(defaultState), updatedAt: serverTimestamp() });
const owner = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
const stranger = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'google.com' } }).firestore();
const guest = env.unauthenticatedContext().firestore();
const anonymous = env.authenticatedContext('anon', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const ref = (db, uid = 'alice') => doc(db, 'users', uid, 'plans', 'default');
let checks = 0;
const denied = async (operation) => { await assertFails(operation); checks++; };
try {
  await env.clearFirestore();
  await assertSucceeds(setDoc(ref(owner), payload()));
  await assertSucceeds(getDoc(ref(owner)));
  await assertSucceeds(setDoc(ref(owner), payload(2)));
  for (const db of [guest, stranger]) {
    await denied(getDoc(ref(db)));
    await denied(setDoc(ref(db), payload(3)));
    await denied(updateDoc(ref(db), { stateJson: '{}' }));
    await denied(deleteDoc(ref(db)));
    await denied(getDocs(collection(db, 'users', 'alice', 'plans')));
  }
  await denied(setDoc(ref(owner, 'bob'), payload()));
  await denied(setDoc(ref(anonymous, 'anon'), payload()));
  await denied(getDocs(collection(owner, 'users', 'alice', 'plans')));
  await denied(deleteDoc(ref(owner)));
  await denied(setDoc(doc(owner, 'users', 'alice'), { isAdmin: true }));
  await denied(setDoc(doc(owner, 'users', 'alice', 'plans', 'extra'), payload()));
  await denied(setDoc(doc(owner, 'users', 'alice', 'plans', 'default', 'nested', 'data'), payload()));
  for (const changes of [
    { stateJson: 'x'.repeat(750001) }, { stateJson: {} }, { stateJson: 123 },
    { revision: 2 }, { revision: 4 }, { revision: -1 }, { revision: 3.5 },
    { schemaVersion: 2 }, { updatedAt: Timestamp.fromMillis(0) }, { updatedAt: 'now' },
    { ownerId: 'bob' }, { isAdmin: true }, { extra: 'payload' }, { stateJson: deleteField() }
  ]) await denied(updateDoc(ref(owner), { ...payload(3), ...changes }));
  await assertSucceeds(setDoc(ref(stranger, 'bob'), payload()));
  await env.withSecurityRulesDisabled(async context => {
    for (const name of ['candidates', 'crawlRuns']) await setDoc(doc(context.firestore(), name, 'private-review'), { status: 'pending_review' });
  });
  for (const db of [guest, owner]) {
    for (const name of ['candidates', 'crawlRuns']) {
      const review = doc(db, name, 'private-review');
      await denied(getDoc(review));
      await denied(getDocs(collection(db, name)));
      await denied(setDoc(doc(db, name, 'new-review'), { status: 'pending_review' }));
      await denied(updateDoc(review, { status: 'published' }));
      await denied(deleteDoc(review));
    }
  }
  console.log(`Firestore rules passed: valid owner read/write; ${checks} unauthorized or malformed operations denied.`);
} finally { await env.cleanup(); }

import { firebaseConfig } from './firebase-config.js';
import { createFirebaseClient, isFirebaseConfigured } from './firebase-client.mjs';
import { validateState, mergePlans, hasPersonalData } from './plan-state.mjs';
import { createPlanStore } from './plan-store.mjs';

export function initializeAccounts({ getState, replaceState, readGuest, writeGuest, notify, exportPlan, onCatalog = () => {} }) {
  const el = (id) => document.getElementById(id);
  let client = null;
  let starting = false;
  let currentStatus = 'loading';
  let draftChanged = false;
  let authGeneration = 0;
  const emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('emulator') === '1';
  const config = emulator ? {
    apiKey: 'demo-key', projectId: 'demo-trywise', authDomain: 'demo-trywise.firebaseapp.com', appId: 'demo-trywise-app'
  } : firebaseConfig;
  const configured = isFirebaseConfigured(config);
  const store = createPlanStore({
    backend: {
      load: (...args) => client.load(...args),
      commit: (...args) => client.commit(...args),
      subscribe: (...args) => client.subscribe(...args)
    },
    readGuest, writeGuest,
    onState(next, options) { draftChanged = false; replaceState(next, options); },
    onUser(user) {
      const generation = ++authGeneration;
      el('adminLink').hidden = true;
      if (user && client) void client.catalog.checkAdmin().then(allowed => {
        if (generation === authGeneration) el('adminLink').hidden = !allowed;
      }).catch(() => {});
      el('accountIdentity').textContent = user ? `Signed in as ${user.email || user.displayName || 'your account'}` : 'You are using a guest plan.';
      el('signInBtn').hidden = Boolean(user);
      el('signOutBtn').hidden = !user;
      el('importGuestBtn').hidden = !user || !hasPersonalData(readGuest());
      el('storageTitle').textContent = user ? 'Account storage' : 'Guest storage';
      el('storageDetail').textContent = user ? 'Plans and preferences sync to your signed-in account.' : 'Saved in this browser. Sign in to save across devices.';
      el('plannerPrivacy').textContent = user ? 'Save options now; start tracking when you’re ready. Your plan is saved to your account.' : 'Browse as a guest. Save options now; start tracking only when you’re ready.';
      el('accountPrivacy').textContent = user
        ? 'Your saved plans, goals, decisions, and preferences are stored in Firebase under your account. Account data is kept in memory on this device and cleared from the app when you sign out. Closing this browser session signs you out.'
        : 'Guest plans stay in this browser. Signing in loads your private account plan. Use Import guest plan to copy your local test data into it.';
    },
    onStatus({ status, message, user, ready, blocked, pending }) {
      currentStatus = status;
      el('syncStatus').textContent = message;
      el('syncStatus').dataset.status = status;
      el('accountBtn').textContent = status === 'loading' ? 'Loading…' : status === 'saving' ? 'Saving…'
        : ['conflict', 'error'].includes(status) ? 'Check save' : status === 'remote' ? 'Updates' : user ? 'Account ✓' : 'Sign in';
      el('retrySyncBtn').hidden = status !== 'error';
      el('loadLatestBtn').hidden = !['remote', 'conflict'].includes(status);
      el('importGuestBtn').disabled = !ready || blocked;
      el('importFile').disabled = !ready || blocked;
      el('signOutBtn').disabled = status === 'saving';
      document.querySelector('main').inert = !ready || blocked;
      el('setupBtn').disabled = !ready || blocked;
      el('onboardingForm').inert = !ready || blocked;
      el('signInBtn').disabled = !configured || starting;
    }
  });

  async function start() {
    if (starting || client) return;
    if (!configured) { onCatalog([], 'local'); await store.setUser(null); return; }
    starting = true;
    el('signInBtn').disabled = true;
    try {
      client = await createFirebaseClient(config, { emulator });
      client.catalog.watchCatalog(records => onCatalog(records, 'ready'), () => onCatalog(null, 'error'));
      client.onAuth((user) => { void store.setUser(user); });
    } catch {
      client = null;
      onCatalog(null, 'error');
      await store.setUser(null);
      el('syncStatus').textContent = 'Account connection unavailable. Your guest plan still works. Try sign-in again when online.';
    } finally { starting = false; el('signInBtn').disabled = false; }
  }

  el('accountBtn').addEventListener('click', () => el('accountDialog').showModal());
  el('closeAccountBtn').addEventListener('click', () => el('accountDialog').close());
  el('signInBtn').addEventListener('click', async () => {
    if (draftChanged && !confirm('There are unfinished form edits. Sign in and leave those edits behind?')) return;
    if (store.hasUnsaved()) { notify('Export your unsaved guest plan before signing in.'); return; }
    el('signInBtn').disabled = true;
    try {
      if (!client) await start();
      if (!client) throw new Error('Account connection unavailable.');
      await client.signIn();
    } catch (error) {
      const messages = {
        'auth/popup-closed-by-user': 'Sign-in canceled. Your guest plan is unchanged.',
        'auth/popup-blocked': 'Allow the sign-in popup for this site and try again.',
        'auth/unauthorized-domain': 'This website domain is not enabled for sign-in yet.',
        'auth/operation-not-allowed': 'Google sign-in has not been enabled for this project yet.'
      };
      el('syncStatus').textContent = messages[error.code] || 'Sign-in could not finish. Check your connection and try again.';
    } finally { el('signInBtn').disabled = false; }
  });
  el('signOutBtn').addEventListener('click', async () => {
    if (!store.canSignOut() && currentStatus === 'saving') { notify('Wait for saving to finish.'); return; }
    if ((store.hasUnsaved() || draftChanged) && !confirm('Sign out and discard unsaved edits? Cancel and export a backup first to keep them.')) return;
    try { await client.signOut(); }
    catch { el('syncStatus').textContent = 'Sign-out failed. Please try again.'; }
  });
  el('retrySyncBtn').addEventListener('click', async () => {
    try { await store.retry(); } catch { notify('Saving is still unavailable. Export a backup before leaving.'); }
  });
  el('loadLatestBtn').addEventListener('click', async () => {
    if ((store.hasUnsaved() || draftChanged) && !confirm('Load the latest account plan and discard your unsaved edits? Cancel and Export a backup first to keep them.')) return;
    await store.loadLatest();
  });
  function importState(incoming) {
    const merged = mergePlans(getState(), incoming);
    store.save(merged);
    replaceState(merged);
    notify('Plan imported. Existing account records were preserved.');
  }
  el('importGuestBtn').addEventListener('click', () => {
    try { importState(readGuest()); } catch (error) { notify(error.message); }
  });
  el('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const uid = store.currentUser()?.uid;
    try {
      if (file.size > 750000) throw new Error('Choose a TryWise JSON export smaller than 750 KB.');
      const data = validateState(JSON.parse(await file.text()));
      if (uid !== store.currentUser()?.uid) throw new Error('Account changed. Select the file again.');
      importState(data);
    } catch (error) { notify(error instanceof SyntaxError ? 'This is not a valid JSON plan export.' : error.message); }
    finally { event.target.value = ''; }
  });
  el('accountExportBtn').addEventListener('click', exportPlan);
  document.addEventListener('input', (event) => {
    if (event.target.closest('#trialForm, #requirementForm, #onboardingForm')) draftChanged = true;
  });
  document.addEventListener('submit', (event) => {
    if (event.target.matches('#trialForm, #requirementForm, #onboardingForm')) draftChanged = false;
  });
  window.addEventListener('beforeunload', (event) => {
    if (store.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('online', () => { if (currentStatus === 'error') void store.retry(); });
  void store.setUser(null);
  // Hide stale private content before checking a previous session's login.
  if (configured) { document.querySelector('main').inert = true; el('setupBtn').disabled = true; }
  void start();
  return store;
}

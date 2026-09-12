import { defaultState, validateState } from './plan-state.mjs';

// Backend-independent session controller: never writes account data to guest storage.
export function createPlanStore({ backend, onState, onStatus, onUser, readGuest, writeGuest }) {
  let user = null;
  let revision = 0;
  let epoch = 0;
  let pending = null;
  let writing = false;
  let ready = false;
  let blocked = false;
  let unsubscribe = () => {};
  let status = 'loading';
  let invalidDraft = false;
  let observedRevision = 0;
  const report = (next, message) => { status = next; onStatus({ status, message, user, pending: Boolean(pending) || invalidDraft, ready, blocked }); };

  async function loadAccount() {
    const token = epoch;
    const uid = user?.uid;
    ready = false;
    report('loading', 'Loading your account…');
    try {
      const data = await backend.load(uid);
      if (token !== epoch) return;
      const next = validateState(data?.state || defaultState);
      revision = data?.revision || 0;
      observedRevision = revision;
      pending = null;
      invalidDraft = false;
      blocked = false;
      onState(next, { reload: true });
      ready = true;
      report('saved', 'Saved to your account');
      unsubscribe();
      unsubscribe = backend.subscribe(uid, (remoteRevision) => {
        if (token !== epoch) return;
        observedRevision = remoteRevision;
        if (writing || remoteRevision === revision) return;
        blocked = true;
        report(pending ? 'conflict' : 'remote', pending
          ? 'Another device changed this plan. Export your edits before loading the latest version.'
          : 'An updated plan is available from another device. Load latest to continue.');
      }, () => { if (token === epoch) report('error', 'Live updates disconnected. Retry to check your account.'); });
    } catch (error) {
      if (token !== epoch) return;
      report('error', 'Could not load your account. Check your connection and database access, then retry.');
    }
  }

  async function setUser(nextUser) {
    epoch++;
    unsubscribe();
    unsubscribe = () => {};
    user = nextUser;
    revision = 0;
    observedRevision = 0;
    pending = null;
    invalidDraft = false;
    writing = false;
    ready = false;
    blocked = false;
    onUser(user);
    // Clear the previous account immediately, even when the next read fails.
    onState(structuredClone(defaultState), { sessionChanged: true });
    if (user) await loadAccount();
    else {
      onState(readGuest());
      ready = true;
      report('guest', 'Guest plan · saved in this browser');
    }
  }

  async function flush() {
    if (writing || !pending || !user || !ready || blocked) return;
    const token = epoch;
    const uid = user.uid;
    writing = true;
    try {
      while (pending && token === epoch) {
        const next = pending;
        report('saving', 'Saving to your account…');
        const updatedRevision = await backend.commit(uid, revision, next);
        if (token !== epoch) return;
        revision = updatedRevision;
        if (pending === next) pending = null;
      }
      if (invalidDraft) report('error', 'Some edits are invalid and have not been saved. Fix them or export a backup.');
      else if (observedRevision > revision) {
        blocked = true;
        report('remote', 'An updated plan is available from another device. Load latest to continue.');
      } else report('saved', 'Saved to your account');
    } catch (error) {
      if (token !== epoch) return;
      blocked = error.code === 'plan/conflict';
      report(blocked ? 'conflict' : 'error', blocked
        ? 'Another device changed this plan. Your edits are still here; export them before loading latest.'
        : 'Changes are not saved to your account. Keep this page open and retry, or export a backup.');
    } finally {
      if (token === epoch) writing = false;
    }
  }

  return {
    setUser,
    save(next) {
      if (!ready || blocked) throw new Error('Load your latest plan before editing.');
      let validated;
      try { validated = validateState(next); invalidDraft = false; }
      catch (error) { invalidDraft = true; report('error', `${error.message} Your edits have not been saved; fix them or export a backup.`); throw error; }
      if (!user) {
        try { writeGuest(validated); pending = null; report('guest', 'Guest plan · saved in this browser'); }
        catch { pending = validated; report('error', 'Browser storage is unavailable. Export a backup before leaving.'); }
        return;
      }
      pending = validated;
      void flush();
    },
    retry() {
      if (invalidDraft) { report('error', 'Fix the invalid or oversized plan before saving, or export a backup.'); return; }
      if (!user) {
        if (pending) { writeGuest(pending); pending = null; report('guest', 'Guest plan · saved in this browser'); }
        return;
      }
      if (pending) return flush();
      return loadAccount();
    },
    loadLatest: loadAccount,
    hasUnsaved: () => Boolean(pending) || invalidDraft,
    canSignOut: () => !pending && !writing && !invalidDraft,
    currentUser: () => user,
    getStatus: () => status
  };
}

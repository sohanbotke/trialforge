import { validateState } from './plan-state.mjs';
import { createCatalogClient } from './catalog-client.mjs';

export function isFirebaseConfigured(config) {
  return ['apiKey', 'projectId', 'authDomain', 'appId'].every((key) =>
    typeof config[key] === 'string' && config[key] && !config[key].startsWith('YOUR_'));
}

export async function createFirebaseClient(config, { emulator = false } = {}) {
  // Pinned modular SDK; loaded only when cloud storage is configured.
  const [appSDK, authSDK, dbSDK] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js')
  ]);
  const app = appSDK.initializeApp(config);
  const auth = authSDK.getAuth(app);
  const db = dbSDK.initializeFirestore(app, { localCache: dbSDK.memoryLocalCache() });
  if (emulator) {
    if (!['localhost', '127.0.0.1'].includes(location.hostname) || !config.projectId.startsWith('demo-')) throw new Error('Emulators require a local demo project.');
    authSDK.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    dbSDK.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  // Session-scoped login avoids retaining a signed-in account on shared devices.
  await authSDK.setPersistence(auth, authSDK.browserSessionPersistence);
  const planRef = (uid) => dbSDK.doc(db, 'users', uid, 'plans', 'default');
  return {
    catalog: createCatalogClient(db, dbSDK, auth),
    onAuth: (callback) => authSDK.onAuthStateChanged(auth, callback),
    signIn: () => authSDK.signInWithPopup(auth, new authSDK.GoogleAuthProvider()),
    signOut: () => authSDK.signOut(auth),
    async load(uid) {
      const snapshot = await dbSDK.getDocFromServer(planRef(uid));
      if (!snapshot.exists()) return null;
      const data = snapshot.data();
      if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Unsupported cloud plan.');
      return { revision: data.revision, state: validateState(JSON.parse(data.stateJson)) };
    },
    async commit(uid, expectedRevision, state) {
      const validated = validateState(state);
      return dbSDK.runTransaction(db, async (transaction) => {
        const ref = planRef(uid);
        const current = await transaction.get(ref);
        const revision = current.exists() ? current.data().revision : 0;
        if (revision !== expectedRevision) {
          const error = new Error('Your plan changed on another device.');
          error.code = 'plan/conflict';
          throw error;
        }
        transaction.set(ref, { schemaVersion: 1, revision: revision + 1, stateJson: JSON.stringify(validated), updatedAt: dbSDK.serverTimestamp() });
        return revision + 1;
      });
    },
    subscribe(uid, onRevision, onError) {
      return dbSDK.onSnapshot(planRef(uid), { includeMetadataChanges: true }, (snapshot) => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) onRevision(snapshot.exists() ? snapshot.data().revision : 0);
      }, onError);
    }
  };
}

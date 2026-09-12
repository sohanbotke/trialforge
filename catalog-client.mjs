import { validateOffer } from './catalog-model.mjs';
import { identityKey, duplicateMatches } from './offer-identity.mjs';
import { seedCatalog } from './seed-catalog.mjs';

export function createCatalogClient(db, sdk, auth) {
  const ref = (collection, id) => sdk.doc(db, collection, id);
  const revision = snap => snap.exists() ? snap.data().revision || 0 : 0;
  async function checkAdmin() {
    if (!auth.currentUser) return false;
    try { await sdk.getDocFromServer(ref('adminAccess', 'status')); return true; }
    catch (error) { if (error.code === 'permission-denied') return false; throw error; }
  }
  async function matchingOffers(offer) {
    const snapshot=await sdk.getDocsFromServer(sdk.query(sdk.collection(db,'catalog'),sdk.limit(501)));
    if(snapshot.size>500)throw new Error('Catalog exceeds the duplicate-check limit. Add pagination before publishing.');
    const all=new Map(seedCatalog.map(v=>[v.id,v]));
    for(const doc of snapshot.docs)all.set(doc.id,{...doc.data(),id:doc.id});
    return duplicateMatches(offer,[...all.values()]);
  }
  return {
    checkAdmin,
    matchingOffers,
    watchCatalog(next, error) {
      return sdk.onSnapshot(sdk.query(sdk.collection(db, 'catalog'), sdk.limit(500)), { includeMetadataChanges: true }, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) next(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
      }, error);
    },
    async candidates(cursor) {
      const constraints = [sdk.orderBy('observedAt', 'desc'), sdk.limit(25)];
      if (cursor) constraints.push(sdk.startAfter(cursor));
      const snapshot = await sdk.getDocsFromServer(sdk.query(sdk.collection(db, 'candidates'), ...constraints));
      return { items: snapshot.docs.map(doc => {
        const envelope = doc.data();
        let data;
        try { data = envelope.payloadJson ? JSON.parse(envelope.payloadJson) : envelope; } catch { data = {}; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
        return { ...data, id: doc.id, title: typeof data.title === 'string' ? data.title.slice(0,200) : `Malformed candidate ${doc.id}`, url: typeof data.url === 'string' ? data.url : '', evidence: Array.isArray(data.evidence) ? data.evidence : [] };
      }), cursor: snapshot.docs.at(-1), more: snapshot.size === 25 };
    },
    async review(id) { const doc = await sdk.getDocFromServer(ref('candidateReviews', id)); return doc.exists() ? doc.data() : null; },
    async offer(id) { const doc = await sdk.getDocFromServer(ref('catalog', id)); return doc.exists() ? doc.data() : null; },
    async decide({ candidateId, expectedReview = 0, expectedCatalog = 0, offer, decision, notes = '', distinctVariant = false }) {
      const uid = auth.currentUser?.uid;
      if (!uid || !/^[a-zA-Z0-9-]{1,100}$/.test(candidateId)) throw new Error('Sign in and select a valid candidate.');
      if (!['approved', 'rejected'].includes(decision)) throw new Error('Unknown decision.');
      const data = decision === 'approved' ? validateOffer(offer) : null;
      if(data){
        data.identityKey=identityKey(data);
        const matches=await matchingOffers(data);
        const exact=matches.find(v=>v.match==='exact');
        if(exact)throw new Error(`Duplicate identity: update existing offer ${exact.id} instead.`);
        if(matches.length&&!distinctVariant)throw new Error('Possible duplicate: update the existing offer or confirm this is a distinct plan, region or promotion.');
      }
      if (notes.length > 1000) throw new Error('Review notes must be under 1,000 characters.');
      await sdk.runTransaction(db, async tx => {
        if (auth.currentUser?.uid !== uid) throw new Error('Account changed; reload the review.');
        const reviewRef = ref('candidateReviews', candidateId);
        const review = await tx.get(reviewRef);
        if (revision(review) !== expectedReview) throw new Error('This review changed in another tab. Reload it before saving.');
        let catalogRef, keyRef, keySnap;
        if (data) {
          catalogRef = ref('catalog', data.id);
          const previous = await tx.get(catalogRef);
          if (revision(previous) !== expectedCatalog) throw new Error('This offer changed or the ID already exists. Reload the target offer before publishing.');
          if(previous.exists()&&previous.data().identityKey&&previous.data().identityKey!==data.identityKey)throw new Error('This ID belongs to a different identity. Use a new ID for a distinct offer; withdraw the old listing separately if needed.');
          keyRef=ref('offerKeys',data.identityKey);keySnap=await tx.get(keyRef);
          if(keySnap.exists()&&keySnap.data().offerId!==data.id)throw new Error(`Duplicate identity: use reserved offer ID ${keySnap.data().offerId}.`);
        }
        const time = sdk.serverTimestamp();
        if(data&&!keySnap.exists())tx.set(keyRef,{offerId:data.id,schemaVersion:1,createdAt:time});
        if (data) tx.set(catalogRef, { ...data, expiresAt: data.expiresAt ? sdk.Timestamp.fromDate(new Date(data.expiresAt)) : null,
          sourceCandidate: candidateId, schemaVersion: 1, status: 'published', revision: expectedCatalog + 1, verifiedAt: time, updatedAt: time });
        tx.set(reviewRef, { candidateId, status: decision, publishedId: data?.id || '', notes,
          reviewedBy: uid, reviewedAt: time, revision: expectedReview + 1, schemaVersion: 1 });
      });
    },
    async withdraw(id, expectedRevision) {
      await sdk.runTransaction(db, async tx => {
        const target = ref('catalog', id);
        const previous = await tx.get(target);
        if (revision(previous) !== expectedRevision) throw new Error('Offer changed. Refresh before withdrawing it.');
        tx.set(target, { id, schemaVersion: 1, status: 'withdrawn', revision: expectedRevision + 1, updatedAt: sdk.serverTimestamp(),
          ...(previous.data()?.identityKey ? {identityKey:previous.data().identityKey} : {}) });
      });
    }
  };
}

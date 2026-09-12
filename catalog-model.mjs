import { validateIdentity, identityKey } from './offer-identity.mjs';
export const categories = ['design','family','productivity','devtools','learning','home','shows','health','finance','meals','delivery','services','cloudinfra','aiapis','harnesses'];
export const offerTypes = { trial: 'Free trial', free_tier: 'Free tier', discount: 'Intro discount', guarantee: 'Money-back guarantee', open_source: 'Open source' };
// Private candidate payloads are untrusted, even after server-side extraction.
export function draftSuggestions(item) {
  const draft = item?.aiDraft;
  if (draft?.schemaVersion !== 1 || draft.status !== 'unverified' || draft.provider !== 'ollama-local' || draft.sourceUrl !== item.evidenceUrl) return null;
  const limits = { name:120, description:1000, offerType:30, priceDetails:500, eligibility:500, region:120, cancellation:500, currency:3 };
  const numbers = { trialDays:365, monthlyValue:100000, upfrontCost:100000 };
  const fields = {}, evidence = [];
  for (const key of [...Object.keys(limits), ...Object.keys(numbers)]) {
    const entry = draft.fields?.[key], value = entry?.value;
    if (typeof entry?.quote !== 'string' || entry.quote.length < 8 || entry.quote.length > 300) continue;
    if (Object.hasOwn(numbers,key)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > numbers[key] || (key === 'trialDays' && !Number.isInteger(value))) continue;
    } else if (typeof value !== 'string' || !value.trim() || value.length > limits[key]) continue;
    if (key === 'offerType' && !Object.hasOwn(offerTypes,value)) continue;
    if (key === 'currency' && value !== 'USD') continue;
    fields[key] = value; evidence.push({key,quote:entry.quote});
  }
  if ((fields.offerType !== 'trial' && fields.trialDays > 0) || (fields.offerType === 'trial' && fields.trialDays === 0)) delete fields.trialDays;
  if (['free_tier','open_source'].includes(fields.offerType) && fields.monthlyValue > 0) delete fields.monthlyValue;
  if (fields.currency !== 'USD') for (const key of ['monthlyValue','upfrontCost']) if(fields[key] > 0) delete fields[key];
  return { fields, evidence: evidence.filter(v=>Object.hasOwn(fields,v.key)),
    missing: [...Object.keys(limits),...Object.keys(numbers)].filter(key=>!Object.hasOwn(fields,key)),
    warnings: Array.isArray(draft.warnings) ? draft.warnings.filter(v=>typeof v==='string').slice(0,12).map(v=>v.slice(0,200)) : [],
    model: typeof draft.model === 'string' ? draft.model.slice(0,120) : 'local model' };
}
const requiredText = { id: 80, name: 120, description: 1000, category: 30, url: 2000, offerType: 30, priceDetails: 500, eligibility: 500, region: 120, cancellation: 500, goal: 500 };
export function validateOffer(input) {
  const data = {};
  for (const [key, max] of Object.entries(requiredText)) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > max) throw new Error(`Complete ${key} (maximum ${max} characters).`);
    data[key] = input[key].trim();
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(data.id)) throw new Error('Offer ID must use lowercase letters, numbers, and hyphens.');
  const url = new URL(data.url);
  if (url.protocol !== 'https:' || url.username || url.password || /[<>"\s]/.test(data.url)) throw new Error('Use a public HTTPS offer URL without credentials.');
  if (!categories.includes(data.category) || !Object.hasOwn(offerTypes, data.offerType)) throw new Error('Select a category and offer type.');
  for (const key of ['trialDays', 'reviewDays', 'monthlyValue', 'upfrontCost']) {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw new Error(`Invalid ${key}.`);
    data[key] = value;
  }
  if (!Number.isInteger(data.trialDays) || data.trialDays > 365 || !Number.isInteger(data.reviewDays) || data.reviewDays < 1 || data.reviewDays > 365) throw new Error('Day counts must be whole numbers within 1–365 (trial can be 0).');
  if ((data.offerType === 'trial') !== (data.trialDays > 0)) throw new Error('Only a real free trial can have trial days; other types use a planning review period.');
  if (['free_tier', 'open_source'].includes(data.offerType) && data.monthlyValue !== 0) throw new Error('Free tiers/open-source plans must have a $0 base monthly cost. Describe usage/API costs in pricing details.');
  if (input.currency !== 'USD') throw new Error('This version of the planner supports USD offers only.');
  data.currency = 'USD';
  if(input.identity !== undefined){data.identity=validateIdentity(input.identity);data.identityKey=identityKey(data);}
  data.expiresAt = input.expiresAt ?? null;
  if (data.expiresAt !== null && (!Number.isFinite(new Date(data.expiresAt).getTime()) || new Date(data.expiresAt) <= new Date())) throw new Error('Offer expiry must be in the future, or blank if not stated.');
  return data;
}

export function mergedCatalog(seeds, records, now = Date.now()) {
  const entries = new Map(seeds.map(item => [item.id, { ...item, verificationStatus: 'unreviewed' }]));
  for (const record of records) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(record.id)) continue;
    entries.delete(record.id); // Tombstones and expired overrides suppress seeds too.
    if (record.status !== 'published') continue;
    const expiry = record.expiresAt?.toMillis?.() ?? (record.expiresAt ? Date.parse(record.expiresAt) : null);
    if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now)) continue;
    try {
      const data = validateOffer({ ...record, expiresAt: expiry === null ? null : new Date(expiry).toISOString() });
      entries.set(record.id, { ...data, source: 'official', categories: [data.category], facets: [offerTypes[data.offerType]],
        trialDays: data.offerType === 'trial' ? data.trialDays : data.reviewDays,
        providerTrialDays: data.trialDays, verificationStatus: 'reviewed', verified: record.verifiedAt?.toDate?.().toISOString().slice(0, 10) || '',
        cancelBurden: 'See terms', catalogRevision: record.revision });
    } catch { /* A malformed cloud entry must not break the guest planner. */ }
  }
  return [...entries.values()];
}

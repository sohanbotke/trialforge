// Product policy, not a promise that an offer cannot change inside the window.
// A successful fetch or an unchanged page must never advance verifiedAt.
export const REVIEW_WINDOW_DAYS = 7;
export const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 86400000;
export const retiredOffers = Object.freeze({
  'github-models': {
    retiredAt: '2026-07-30', checkedAt: '2026-09-27',
    source: 'https://docs.github.com/en/github-models',
    reason: 'GitHub retired the Models playground, catalog and inference API on July 30, 2026. GitHub Copilot is a separate service.'
  }
});

export function timestampMillis(value) {
  try {
    if (typeof value?.toMillis === 'function') return finite(value.toMillis());
    if (typeof value?.toDate === 'function') return finite(value.toDate().getTime());
    if (value instanceof Date) return finite(value.getTime());
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0,10) === value.slice(0,10) ? parsed : null;
    }
  } catch { /* Fail closed on malformed timestamps, including SDK-like objects. */ }
  return null;
}
const finite = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;

export function offerStatus(record, now = Date.now()) {
  if (Object.hasOwn(retiredOffers, record.id)) return 'retired';
  if (record.status === 'withdrawn' || record.status === 'gone') return 'withdrawn';
  if (record.status !== 'published') return 'unreviewed';
  if (record.expiresAt != null) {
    const expiry = timestampMillis(record.expiresAt);
    if (expiry === null || expiry <= now) return 'expired';
  }
  const checked = timestampMillis(record.verifiedAt);
  if (!Number.isFinite(now) || checked === null || checked > now) return 'needs_verification';
  return now - checked >= REVIEW_WINDOW_MS ? 'stale' : 'current';
}

export function recheckQueue(records, now = Date.now()) {
  return records.filter(record => record.status === 'published').map(record => {
    const verifiedAt = timestampMillis(record.verifiedAt);
    const expiry = timestampMillis(record.expiresAt);
    const status = offerStatus(record,now);
    const dueAt = status === 'retired' || verifiedAt === null || verifiedAt > now ? now : Math.min(verifiedAt + REVIEW_WINDOW_MS, expiry ?? Infinity);
    return {id:record.id, name:record.name || record.id, url:record.url || '', status,
      verifiedAt:verifiedAt === null ? null : new Date(verifiedAt).toISOString(),
      dueAt:new Date(dueAt).toISOString()};
  }).filter(record => record.status !== 'current').sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}

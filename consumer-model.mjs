// Consumer-facing claims must be supported by reviewed catalog data.
import { offerStatus, REVIEW_WINDOW_DAYS } from './catalog-policy.mjs';

const searchWords = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g) || [];
const genericWords = new Set('a an the i my me we our you your to for of with and or in on at is are be can could would should want need looking find best good useful something way before after try trial trials app apps service services option options free cheapest'.split(' '));
const datingWords = ['dating','relationship','relationships','matchmaking','singles','tinder','bumble','hinge','eharmony'];
export function searchIntent(query) {
  const words = searchWords(query);
  if (words.some(word=>datingWords.includes(word)) || (words.includes('love') && !words.some(word=>['movie','movies','show','shows','book','books','music','song','songs','coding','code'].includes(word)))) return 'relationships';
  return 'general';
}
export function searchTextScore(offer, query) {
  const words = new Set(searchWords([offer.name,offer.description,offer.goal,...(offer.categories||[]),...(offer.facets||[])].join(' ')));
  if (searchIntent(query) === 'relationships') return datingWords.some(word=>words.has(word)) ? 1 : 0;
  return [...new Set(searchWords(query).filter(word=>!genericWords.has(word)))].filter(word=>words.has(word)).length;
}
export function matchesCatalogSearch(offer,query) {
  return !query.trim() || searchTextScore(offer,query)>0;
}
export function emptySearchMessage(query) {
  return searchIntent(query) === 'relationships'
    ? 'You’re looking for dating or relationship services. We don’t have matching entries in the current catalog yet. We won’t substitute unrelated offers. You can browse all options or track a service you already use in My Try Plan.'
    : 'No relevant catalog matches yet. Try a provider name or a more specific topic, or clear the search to browse all options.';
}

export function isReviewed(offer) {
  return offer.verificationStatus === 'reviewed' && offerStatus({...offer, status:'published'}) === 'current';
}

export function reviewLabel(offer) {
  if (!offer) return 'Not currently in the catalog';
  if (isReviewed(offer)) return `Reviewed ${offer.verified || '(date unavailable)'}`;
  if (offer.verificationStatus === 'stale' || (offer.verificationStatus === 'reviewed' && offer.verifiedAt)) return `Needs recheck — last reviewed ${offer.verified || 'date unknown'}`;
  if (offer.verificationStatus === 'needs_verification' || offer.verificationStatus === 'reviewed') return 'Needs verification — review date missing or invalid';
  return 'Unreviewed preview';
}

export function offerConfidence(offer) {
  if (isReviewed(offer)) return {label:'Admin reviewed', detail:`${reviewLabel(offer)}. ${offer.priceDetails} Region: ${offer.region}. Cancellation: ${offer.cancellation}`};
  if (['stale','needs_verification','reviewed'].includes(offer.verificationStatus)) return {label:'Needs recheck', detail:`${reviewLabel(offer)}. Reviews are current for less than ${REVIEW_WINDOW_DAYS} days. Previous costs and terms are not current; verify with the provider.`};
  return {label:'Review needed', detail:'Research starting point only. Current price, availability, eligibility and terms have not been approved. Confirm with the provider.'};
}

export function reviewedCost(offer, field = 'monthlyValue') {
  const cost = offer[field];
  return isReviewed(offer) && typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function reviewedFirst(a, b) {
  return Number(isReviewed(b)) - Number(isReviewed(a));
}

export function matchesConsumerFilters(offer, { maximum = '', review = 'all', type = 'all' } = {}) {
  if (review === 'reviewed' && !isReviewed(offer)) return false;
  // Starter type assertions have not been reviewed either.
  if (type !== 'all' && (!isReviewed(offer) || offer.offerType !== type)) return false;
  if (maximum !== '') {
    const cost = reviewedCost(offer);
    if (cost === null || cost > Number(maximum)) return false;
  }
  return true;
}

export function shortlistRecord(offer, { id, createdAt }) {
  return {
    id, catalogId: offer.id, service: offer.name,
    // Retained for compatibility; saved items are excluded from cost totals.
    monthlyValue: reviewedCost(offer) ?? 0,
    startDate: '', endDate: '', status: 'saved',
    goal: offer.goal || '', keepCriteria: '', checks: {}, createdAt
  };
}

// Only reviewed catalog facts belong in a comparison; a saved price is not
// evidence of today's offer. Return plain text and escape it at the UI boundary.
export function comparisonFacts(offer) {
  const unknown = 'Not confirmed';
  if (!offer || !isReviewed(offer)) return {
    review: reviewLabel(offer),
    upfront: unknown, monthly: unknown, duration: unknown,
    pricing: unknown, eligibility: unknown, region: unknown, cancellation: unknown
  };
  const money = value => value === null ? unknown : `$${value.toFixed(2)}`;
  return {
    review: `Reviewed ${offer.verified || '(date unavailable)'}`,
    upfront: money(reviewedCost(offer, 'upfrontCost')),
    monthly: reviewedCost(offer) === null ? unknown : `${money(reviewedCost(offer))}/mo${offer.offerType === 'trial' ? ' after trial' : ' base'}`,
    duration: offer.offerType === 'trial' && Number.isInteger(offer.providerTrialDays) && offer.providerTrialDays > 0
      ? `${offer.providerTrialDays} days` : offer.offerType === 'trial' ? unknown : 'No trial countdown',
    ...Object.fromEntries(['pricing', 'eligibility', 'region', 'cancellation'].map(key => [key, offer[key === 'pricing' ? 'priceDetails' : key] || unknown]))
  };
}

export function decisionCalendar(trial, now = new Date()) {
  if (trial.status !== 'active' || !/^\d{4}-\d{2}-\d{2}$/.test(trial.endDate)) throw new Error('Start tracking and confirm a decision date first.');
  const date = new Date(`${trial.endDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== trial.endDate) throw new Error('Invalid decision date.');
  const end = new Date(date);
  end.setUTCDate(end.getUTCDate() + 1);
  const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escape = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  // Fold at 75 UTF-8 octets without splitting a Unicode character (RFC 5545).
  const fold = line => {
    const lines = []; let part = '', size = 0;
    for (const char of line) {
      const bytes = new TextEncoder().encode(char).length;
      if (size + bytes > 75) { lines.push(part); part = ' '; size = 1; }
      part += char; size += bytes;
    }
    lines.push(part); return lines.join('\r\n');
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TryWise//Decision planner//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${encodeURIComponent(trial.id)}-${trial.endDate}@trywise`, `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${stamp(date).slice(0, 8)}`, `DTEND;VALUE=DATE:${stamp(end).slice(0, 8)}`,
    `SUMMARY:${escape(`Decide about ${trial.service}`)}`,
    'DESCRIPTION:Check provider terms and decide whether to keep or cancel. TryWise does not cancel subscriptions. Set your preferred reminder in your calendar app.',
    'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}

// Consumer-facing claims must be supported by reviewed catalog data.
import { offerStatus, REVIEW_WINDOW_DAYS, timestampMillis } from './catalog-policy.mjs';

const searchWords = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g) || [];
const genericWords = new Set('a an the i my me we our you your to for of with and or in on at is are be can could would should want need looking find best good useful something way before after try trial trials app apps service services option options free cheapest love like place paying run'.split(' '));
const datingWords = ['dating','relationship','relationships','matchmaking','tinder','bumble','hinge','eharmony'];
const normalized = text => searchWords(text).join(' ');
const stem = word => ({cooking:'cook',recipes:'recipe',groceries:'grocery',locally:'local',apis:'api',models:'model',harnesses:'harness',books:'book',audiobooks:'audiobook',shows:'show',movies:'movie',tools:'tool',meals:'meal'})[word] || word;
const keywords = text => [...new Set(searchWords(text).filter(word=>!genericWords.has(word)).map(stem))];

export function searchIntent(query) {
  const words = searchWords(query);
  if (words.some(word=>datingWords.includes(word)) || /\b(find love|meet singles|romantic partner)\b/.test(normalized(query))) return 'relationships';
  return 'general';
}

// Bounded edit distance is used for provider names only, never descriptions.
function editDistance(a, b) {
  let row = Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {
    const next=[i];
    for(let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));
    row=next;
  }
  return row[b.length];
}

function providerMatch(offer, query) {
  const name=normalized(offer.name), text=normalized(query);
  if(!text || text.length>100) return {score:0,reason:''};
  if(name===text) return {score:1000,reason:'Exact provider name'};
  const tokens=keywords(text);
  if(!tokens.length) return {score:0,reason:''};
  if(name.startsWith(text) && text.length>=3) return {score:800,reason:'Provider name starts with your search'};
  if(name.includes(text) && text.length>=3) return {score:700,reason:'Provider name contains your search'};
  const names=keywords(name).filter(word=>word.length>=4 && !['premium','standard','professional','plus','cloud','model','tool','hosting','streaming','membership'].includes(word));
  if(tokens.some(word=>names.includes(word))) return {score:600,reason:'Provider name match'};
  // A short query or provider-shaped token can be a typo, not a fuzzy topic.
  for(const token of tokens.slice(0,12)) {
    if(token.length<4 || token.length>40) continue;
    const limit=token.length>=8?2:1;
    const candidate=[...names,name].find(value=>value.length<=40 && Math.abs(value.length-token.length)<=limit && editDistance(token,value)<=limit);
    if(candidate) return {score:500,reason:`Possible provider spelling match: ${offer.name}`};
  }
  return {score:0,reason:''};
}

export function searchTextScore(offer, query) {
  const words = new Set(keywords([offer.name,offer.description,offer.goal,...(offer.categories||[]),...(offer.facets||[])].join(' ')));
  return providerMatch(offer,query).score + keywords(query).filter(word=>words.has(word)).length * 10;
}

export function rankCatalogOffers(offers, {text='', categories=[], facets=[], interests=[], budget=0, preference='balanced'}={}) {
  const words=keywords(text), genericOfferQuery=!words.length && /\b(free|trials?)\b/.test(normalized(text));
  const intent=searchIntent(text);
  return offers.map(offer=>{
    const provider=providerMatch(offer,text);
    const overlap=searchTextScore(offer,text)-provider.score;
    const categoryMatches=(offer.categories||[]).filter(value=>categories.includes(value));
    const facetMatches=(offer.facets||[]).filter(value=>facets.includes(value));
    const offerWords=searchWords([offer.name,offer.description,...(offer.categories||[]),...(offer.facets||[])].join(' '));
    const intentMatch=intent==='relationships' && datingWords.some(word=>offerWords.includes(word));
    const genericMatch=genericOfferQuery && (isReviewed(offer)
      ? ['trial','free_tier','open_source'].includes(offer.offerType)
      : /\b(free|trial|open source)\b/.test(normalized([offer.name,...(offer.facets||[])].join(' '))));
    // Interests and price may reorder relevant results, but cannot manufacture a match.
    const relevance=provider.score+overlap+facetMatches.length*35+categoryMatches.length*15+Number(intentMatch)*30+Number(genericMatch)*10;
    const affinity=(offer.categories||[]).filter(value=>interests.includes(value)).length*2;
    const cost=reviewedCost(offer);
    const affordable=cost!==null && budget>0 && cost<=budget;
    const score=relevance+affinity+Number(affordable)*2;
    const why=provider.reason || (facetMatches.length?`Matches ${facetMatches.join(', ')}`:categoryMatches.length?`Matches ${categoryMatches.join(', ')}`:genericMatch?'Trial/free-option research match':'Keyword match');
    return {...offer,score,relevance,rankReason:`${why}. ${isReviewed(offer)?'Check limits and terms for your needs.':'Research option; costs and terms need confirmation.'}`};
  }).filter(offer=>!text.trim() || offer.relevance>0)
    .sort((a,b)=>b.score-a.score || reviewedFirst(a,b)
      || (isReviewed(a) && isReviewed(b) ? timestampMillis(b.verifiedAt)-timestampMillis(a.verifiedAt):0)
      || (preference==='lowest-cost' && reviewedCost(a)!==null && reviewedCost(b)!==null ? reviewedCost(a)-reviewedCost(b):0) || a.name.localeCompare(b.name));
}

export function searchCoverageMessage(query, offers) {
  if(/\bmusic\b/.test(normalized(query)) && !offers.some(offer=>/\b(music|songs?)\b/.test(normalized([offer.name,...(offer.facets||[])].join(' '))))) {
    return 'No music service is in the current catalog. Any streaming results below are adjacent TV/show options, not music-service matches.';
  }
  if(/^(netflix|netflx)$/.test(normalized(query)) && !offers.some(offer=>normalized(offer.name).includes('netflix'))) {
    return 'Did you mean Netflix? Netflix is not in this catalog. We cannot show or confirm a Netflix offer.';
  }
  return '';
}
export function matchesCatalogSearch(offer,query) {
  return rankCatalogOffers([offer],{text:query}).length>0;
}
export function emptySearchMessage(query) {
  return searchIntent(query) === 'relationships'
    ? 'You’re looking for dating or relationship services. We don’t have matching entries in the current catalog yet. We won’t substitute unrelated offers. You can browse all options or track a service you already use in My Try Plan.'
    : normalized(query)==='love' ? 'If you mean dating or relationship services, we don’t have matching entries yet. Try a more specific topic or browse all options.'
    : 'No relevant catalog matches yet. Try a provider name or a more specific topic, or clear the search to browse all options.';
}

export function isReviewed(offer) {
  return offer.verificationStatus === 'reviewed' && offerStatus({...offer, status:'published'}) === 'current';
}

export function reviewLabel(offer) {
  if (!offer) return 'Not currently in the catalog';
  const checked=timestampMillis(offer.verifiedAt);
  const date=checked===null?'date unknown':new Date(checked).toISOString().slice(0,10);
  if (isReviewed(offer)) return `Terms checked ${date}`;
  if (checked !== null && ['stale','reviewed'].includes(offer.verificationStatus)) return `Needs recheck — last checked ${date}`;
  if (['needs_verification','reviewed','stale'].includes(offer.verificationStatus)) return 'Needs verification — check date missing or invalid';
  return 'Terms not confirmed';
}

export function offerConfidence(offer) {
  if (isReviewed(offer)) return {label:'Terms checked', detail:`${reviewLabel(offer)}. Offers can change; this is not a provider endorsement. ${offer.priceDetails} Region: ${offer.region}. Cancellation: ${offer.cancellation}`};
  if (['stale','needs_verification','reviewed'].includes(offer.verificationStatus)) return {label:'Needs recheck', detail:`${reviewLabel(offer)}. Reviews are current for less than ${REVIEW_WINDOW_DAYS} days. Previous costs and terms are not current; verify with the provider.`};
  return {label:'Terms not confirmed', detail:'Research starting point only. Current price, availability, eligibility and terms have not been checked. Confirm with the provider.'};
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
    review: reviewLabel(offer),
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

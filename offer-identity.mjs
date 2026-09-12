// Stable identity is explicit, never inferred from price or model-generated prose.
export const identityFields = ['provider','product','plan','region','scope'];
export const sourceOffers = {'github-copilot-plans':'github-copilot','cloudflare-workers-pricing':'cloudflare-workers'};
const seedParts = {
  'adobe-express':['adobe','express','premium'], 'canva-pro':['canva','canva','pro'],
  'figma-professional':['figma','figma','professional'], 'notion-plus':['notion','notion','plus'],
  'github-copilot':['github','copilot','free'], 'linear':['linear','linear',''],
  'masterclass':['masterclass','membership',''], 'skillshare':['skillshare','membership',''],
  'audible-standard':['amazon','audible','standard'], 'kindle-unlimited':['amazon','kindle','unlimited'],
  'headspace':['headspace','headspace',''], 'ynab':['ynab','ynab',''], 'hulu':['disney','hulu',''],
  'youtube-tv':['google','youtube-tv',''], 'hellofresh':['hellofresh','meal-kits',''],
  'instacart-plus':['instacart','instacart','plus'], 'doordash-dashpass':['doordash','dashpass',''],
  'thumbtack':['thumbtack','marketplace',''], 'cloudflare-workers':['cloudflare','workers','free'],
  'vercel-hobby':['vercel','hosting','hobby'], 'netlify-free':['netlify','hosting','free'],
  'render-free':['render','hosting','free'], 'oracle-cloud-free':['oracle','cloud',''],
  'aws-free-tier':['amazon','aws',''], 'google-cloud-free':['google','cloud',''],
  'gemini-api-free':['google','gemini-api','free'], 'groq-api-free':['groq','api','free'],
  'openrouter-free-models':['openrouter','api','free-models'], 'cloudflare-workers-ai':['cloudflare','workers-ai','free'],
  'github-models':['github','models',''], 'aider':['aider','aider','local'],
  'opencode':['opencode','opencode','local'], 'continue':['continue','continue',''],
  'openhands':['openhands','openhands',''], 'litellm':['litellm','litellm','']
};
export function identityHint(id) {
  const [provider='',product='',plan=''] = seedParts[id] || [];
  return {provider,product,plan,region:'',scope:'general'};
}
export function validateIdentity(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==5) throw new Error('Complete the five offer identity fields.');
  const result={};
  for(const field of identityFields){
    if(typeof value[field]!=='string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value[field])) throw new Error(`Identity ${field} must be a lowercase identifier (1–40 letters, numbers or hyphens).`);
    result[field]=value[field];
  }
  return result;
}
export function identityKey(offer) {
  const v=validateIdentity(offer.identity);
  if(!['trial','free_tier','discount','guarantee','open_source'].includes(offer.offerType) || offer.currency!=='USD') throw new Error('Complete offer type and USD currency before matching.');
  return ['v1',v.provider,v.product,v.plan,offer.offerType,v.region,v.scope,'usd'].join('~');
}
export function decodeIdentityKey(key){
  if(typeof key!=='string')throw new Error('Invalid saved offer identity.');
  const parts=key.split('~');
  if(parts.length!==8||parts[0]!=='v1'||parts[7]!=='usd')throw new Error('Invalid saved offer identity.');
  const [,provider,product,plan,offerType,region,scope]=parts;
  const value={identity:{provider,product,plan,region,scope},offerType,currency:'USD'};
  if(identityKey(value)!==key)throw new Error('Invalid saved offer identity.');
  return value;
}
export function normalizedOfferUrl(value) {
  try {
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password)return '';
    // Keep promo, plan, country, language, price filters, ref, and fragments.
    for(const key of [...url.searchParams.keys()]) if(/^utm_/i.test(key)||/^(gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|igshid)$/i.test(key))url.searchParams.delete(key);
    url.searchParams.sort();url.pathname=url.pathname.replace(/\/+$/,'')||'/';
    return url.href;
  } catch {return '';}
}
export function duplicateMatches(offer, records) {
  let key;try{key=identityKey(offer);}catch{}
  const url=normalizedOfferUrl(offer.url), name=String(offer.name||'').trim().toLowerCase();
  return records.filter(v=>v.id!==offer.id).flatMap(v=>{
    let candidateKey;try{candidateKey=identityKey(v);}catch{}
    const exact=!!key&&key===candidateKey;
    const sameUrl=!!url&&url===normalizedOfferUrl(v.url);
    const sameName=!!name&&name===String(v.name||'').trim().toLowerCase();
    const hint=v.identity||identityHint(v.id), own=offer.identity;
    const sameProduct=own?.provider&&own?.product&&own?.plan&&own.provider===hint.provider&&own.product===hint.product&&own.plan===hint.plan;
    return exact||sameUrl||sameName||sameProduct ? [{...v,match:exact?'exact':'possible',reason:exact?'Same canonical identity':sameUrl?'Same normalized source URL':sameName?'Same offer name':'Same provider, product and plan; check region/type/scope'}] : [];
  });
}
export function groupCandidates(rows) {
  const groups=new Map();
  const ordered=[...rows].sort((a,b)=>(Date.parse(b.item.observedAt)||0)-(Date.parse(a.item.observedAt)||0)||a.item.candidateId.localeCompare(b.item.candidateId));
  const lineage=new Map();
  for(const row of ordered)if(row.item.draftParentId&&!lineage.has(row.item.draftParentId))lineage.set(row.item.draftParentId,row.item);
  const family=row=>row.item.draftParentId||row.item.candidateId;
  const reviewedFamilies=new Set(rows.filter(v=>v.review).map(family));
  for(const row of rows){
    const item=row.item, relative=lineage.get(family(row))||item;
    let key;
    try{key='identity:'+identityKey(relative);}catch{}
    const type=relative.aiDraft?.fields?.offerType?.value;
    // Source pages and similar names are advisory groups, never proof of identity.
    key ||=
      `source:${item.sourceId||normalizedOfferUrl(item.url)||item.candidateId}:${type||'unknown'}:${String(relative.aiDraft?.fields?.name?.value||relative.title||'').toLowerCase()}`;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const date=row=>Date.parse(row.item.observedAt)||0;
  return [...groups].map(([key,versions])=>{
    versions.sort((a,b)=>date(b)-date(a)||Number(!!b.item.aiDraft)-Number(!!a.item.aiDraft)||a.item.candidateId.localeCompare(b.item.candidateId));
    const reviewed=versions.filter(v=>v.review);
    const pending=versions.filter(v=>!v.review&&!reviewedFamilies.has(family(v)));
    const current=pending[0]||reviewed[0]||versions[0];
    return {key,current,pending:pending.length,history:versions.filter(v=>v!==current)};
  }).sort((a,b)=>date(b.current)-date(a.current)||a.key.localeCompare(b.key));
}

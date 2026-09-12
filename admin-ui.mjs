import { firebaseConfig } from './firebase-config.js';
import { createFirebaseClient } from './firebase-client.mjs';
import { seedCatalog } from './seed-catalog.mjs';
import { categories, offerTypes, draftSuggestions } from './catalog-model.mjs';
import { identityFields, identityHint, identityKey, decodeIdentityKey, sourceOffers, duplicateMatches, groupCandidates } from './offer-identity.mjs';
import { starterAudit, auditDate } from './starter-audit.mjs';
const el = id => document.getElementById(id);
const emulator = ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('emulator') === '1';
const config = emulator ? { apiKey:'demo-key',projectId:'demo-trywise',authDomain:'demo-trywise.firebaseapp.com',appId:'demo-trywise-app' } : firebaseConfig;
let client, allowed = false, generation = 0, selectionGeneration = 0, selected = null, expectedReview = 0, expectedCatalog = 0, targetId = '', dirty = false, busy = false, cursor, catalog = [], stopCatalog;
let queueGeneration=0, loadedRows=new Map();
const editor={loading:false,targetLoading:false,published:null,locked:false};
const parked=new Map(), expanded=new Set();
let loadedType='', visibleItems=[];
const rowKey=item=>item.offer ? `offer:${item.offer.id}` : `candidate:${item.candidateId}`;
async function readWithDeadline(operation){
  let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The server did not respond in time. Check your connection and retry')),15000);})]);}finally{clearTimeout(timer);}
}
function showRevisionNotice(){const current=catalog.find(v=>v.id===targetId);const changed=!!selected&&!!current&&current.revision!==expectedCatalog;el('revisionNotice').hidden=!changed;el('revisionNotice').textContent=changed?'This offer changed on the server. Your edits are kept; compare or reload its current details before publishing.':'';}
function syncEditor(){
  el('fields').disabled=busy||editor.loading||editor.targetLoading;
  el('cancel').disabled=busy;
  el('cancel').hidden=!selected&&!editor.loading;
  el('editorStatus').textContent=editor.loading?'Loading review…':editor.targetLoading?'Checking target offer…':'';
  el('editorPanel').setAttribute('aria-busy',String(editor.loading||editor.targetLoading||busy));
  el('saveStatus').textContent=busy?'Saving decision…':dirty?'Unsaved changes — not published':'No unsaved edits';
  el('resumeCurrent').hidden=!selected&&!editor.loading;
  showRevisionNotice();
}
function setDirty(){dirty=true;el('confirmed').checked=false;el('distinctVariant').checked=false;syncEditor();}
function showView(view){el('workspace').dataset.view=view;(view==='editor'?el('editorHeading'):el('queueHeading')).focus();}
function lockIdentity(locked){editor.locked=locked;for(const key of identityFields)identityElement(key).readOnly=locked;el('identityState').textContent=locked?'· locked for this offer':'· complete before publishing';el('identityDetails').open=!locked;}
const identityElement=key=>el('identity'+key[0].toUpperCase()+key.slice(1));
function readIdentity(){return Object.fromEntries(identityFields.map(key=>[key,identityElement(key).value.trim()]));}
function formOffer(){return {id:el('offerId').value.trim(),name:el('name').value,url:el('url').value,offerType:el('offerType').value,currency:'USD',identity:readIdentity()};}
function matchingRecords(){const entries=new Map(seedCatalog.map(v=>[v.id,v]));for(const v of catalog)entries.set(v.id,v);return [...entries.values()];}
function showDuplicates(){
  const panel=el('duplicates');panel.replaceChildren();
  const data=formOffer(), matches=duplicateMatches(data,matchingRecords());
  const summary=document.createElement('p');
  try{identityKey(data);summary.textContent=matches.length?`${matches.length} similar listing(s). Exact identity matches cannot be published under another ID.`:'No matching identity or source found in the loaded catalog. Server checks run again before publishing.';}catch{summary.textContent='Complete offer identity and type to check canonical matches. URL/name matches are suggestions, not automatic merges.';}
  panel.append(summary);el('distinctLabel').hidden=!matches.length;
  for(const match of matches){
    const p=document.createElement('p');p.textContent=`${match.name||match.id} (${match.id}) — ${match.reason}`;panel.append(p);
    panel.append(button(`Update existing offer: ${match.id}`,async()=>{
      if(!allowed||busy||editor.loading||editor.targetLoading||!confirm('Use this existing offer ID and load its current published details? This replaces form edits, not saved user plans.'))return;
      el('offerId').value=match.id;targetId='';dirty=false;
      for(const key of identityFields)identityElement(key).value=(match.identity||identityHint(match.id))[key]||'';
      try{if(await loadTarget()){setDirty();showDuplicates();}}catch(error){message(error.message,true);}
    }));
  }
}
function showCoverage(){const approved=new Set(catalog.filter(v=>v.status==='published').map(v=>v.id));const count=seedCatalog.filter(v=>approved.has(v.id)).length;el('coverage').textContent=`${count}/${seedCatalog.length} starter entries published; ${seedCatalog.length-count} not currently approved/published. Source-audit notes: ${auditDate}; an audit is not approval.`;}
const textKeys = ['name','description','url','category','offerType','priceDetails','eligibility','region','cancellation','goal'];
const numberKeys = ['trialDays','reviewDays','monthlyValue','upfrontCost'];
function message(text, error = false) {
  el('message').textContent = text; el('message').dataset.error = String(error);
  for(const id of ['editorError','actionError']){el(id).textContent=error?text:'';el(id).hidden=!error;}
  if(error&&el('workspace').dataset.view==='editor')el('editorError').focus();
}
function button(text, handler) { const node = document.createElement('button'); node.type = 'button'; node.className = 'entry'; node.textContent = text; node.onclick = handler; return node; }
function resetEditor() {
  selected=null;dirty=false;selectionGeneration++;targetId='';expectedCatalog=0;expectedReview=0;
  Object.assign(editor,{loading:false,targetLoading:false,published:null,locked:false});
  el('reviewForm').reset();el('reviewForm').hidden=true;lockIdentity(false);clearValidation();
  el('duplicates').replaceChildren();el('distinctLabel').hidden=true;el('evidence').replaceChildren();
  el('sourcePanel').hidden=true;el('sourcePanel').open=false;el('draftInfo').replaceChildren();el('draftInfo').hidden=true;
  document.querySelectorAll('.field-evidence').forEach(v=>v.remove());
  el('selection').textContent='Choose an entry to review its evidence and details.';
  message('');syncEditor();updateSelection();
}
function clearValidation(){
  document.querySelectorAll('.field-error').forEach(v=>v.remove());
  el('reviewForm').querySelectorAll('[aria-invalid]').forEach(v=>{v.removeAttribute('aria-invalid');v.removeAttribute('aria-errormessage');});
}
function validateForm(){
  clearValidation();
  const invalid=[...el('reviewForm').elements].filter(v=>v.willValidate&&!v.validity.valid);
  if(!invalid.length)return true;
  message('Check the highlighted fields before publishing. Your edits have been kept.',true);
  const list=document.createElement('ul');
  for(const input of invalid){
    const label=input.labels?.[0]?.childNodes[0]?.textContent?.trim()||input.id;
    const note=document.createElement('small');note.id=`error-${input.id}`;note.className='field-error';note.textContent=input.validationMessage;
    input.after(note);input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',note.id);
    const li=document.createElement('li');li.append(button(label,()=>{const details=input.closest('details');if(details)details.open=true;input.focus();}));list.append(li);
  }
  el('editorError').append(list);el('editorError').focus();return false;
}
function updateSelection(){for(const node of el('queue').querySelectorAll('[data-row-key]')){if(selected&&node.dataset.rowKey===rowKey(selected))node.setAttribute('aria-current','true');else node.removeAttribute('aria-current');}}
function applyDraft(suggestion) {
  // Never let generated text set identity, URLs, revision, private notes or approval.
  for (const key of [...textKeys,...numberKeys].filter(key=>!['url','category','goal','reviewDays'].includes(key))) el(key).value = suggestion.fields[key] ?? '';
  el('expiresAt').value=''; el('confirmed').checked=false;
  el('distinctVariant').checked=false;showDuplicates();
}
function showDraft(item, suggestion, applied) {
  const panel=el('draftInfo'); panel.replaceChildren(); panel.hidden=false;
  const heading=document.createElement('h3'); heading.textContent='AI draft — not verified'; panel.append(heading);
  const status=document.createElement('p'); status.textContent=suggestion ? `${applied ? 'Suggested fields prefilled' : 'Draft available; current published details retained'}. Model: ${suggestion.model}. Matching excerpts do not prove that the model interpreted the terms correctly.` : `No usable AI draft (${item.draftStatus || 'not generated'}). Complete the form manually.`; panel.append(status);
  if(!suggestion)return;
  const missing=document.createElement('p'); missing.textContent=`Needs manual review: ${suggestion.missing.join(', ') || 'all suggested fields'}. Expiry is not extracted; check it separately. URL/category come from the source configuration. Goal and planning interval are editable planner suggestions.`; panel.append(missing);
  const details=document.createElement('details'), summary=document.createElement('summary'); summary.textContent='Field-by-field source excerpts'; details.append(summary);
  const list=document.createElement('ul');
  document.querySelectorAll('.field-evidence').forEach(v=>v.remove());
  for(const {key,quote} of suggestion.evidence){
    const input=el(key);if(!input)continue;
    const label=input.labels?.[0]?.childNodes[0]?.textContent?.trim()||key;
    const li=document.createElement('li');li.className='comparison';
    const title=document.createElement('strong');title.textContent=label;li.append(title);
    const values=document.createElement('dl');
    for(const [label,value] of [['Published',editor.published?.[key]??'No published value'],['AI suggestion',suggestion.fields[key]]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);values.append(dt,dd);}
    li.append(values);const excerpt=document.createElement('blockquote');excerpt.textContent=quote;li.append(excerpt);
    const accept=()=>{if(!allowed||busy||editor.loading||editor.targetLoading||selected!==item)return;input.value=suggestion.fields[key];setDirty();showDuplicates();input.focus();message(`${label} suggestion applied. Verify it against the source before approving.`);};
    li.append(button(`Use suggestion for ${label}`,accept));list.append(li);
    const inline=document.createElement('details');inline.className='field-evidence';const summary=document.createElement('summary');summary.textContent=`Compare source suggestion for ${label}`;inline.append(summary);
    const text=document.createElement('p');text.textContent=`Published: ${editor.published?.[key]??'not available'}. AI suggestion: ${suggestion.fields[key]}. Source: “${quote}”`;inline.append(text,button(`Apply ${label} suggestion`,accept));input.closest('label').after(inline);
  }
  for(const warning of suggestion.warnings){const li=document.createElement('li');li.textContent=warning;list.append(li);}
  details.append(list);panel.append(details);
  panel.append(button('Use AI draft fields',()=>{if(!allowed||busy||editor.loading||editor.targetLoading||selected!==item)return;if(confirm('Replace editable offer terms with this unverified AI draft? Missing values will be blank, and you must recheck the official terms.')){applyDraft(suggestion);setDirty();message('AI draft applied. Complete unknown fields and verify every term before approving.');}}));
}
function mayLeave() { return !busy && (!dirty || confirm('Discard unfinished review edits? Use “Keep draft in this tab” first if you want to resume them.')); }
function fill(data) {
  for (const key of textKeys) el(key).value = data[key] ?? '';
  for (const key of numberKeys) el(key).value = data[key] ?? (key === 'reviewDays' ? 30 : 0);
  el('offerId').value = data.id;
  el('category').value = data.category || data.categories?.[0] || '';
  const expiry = data.expiresAt?.toDate?.();
  el('expiresAt').value = expiry ? new Date(expiry.getTime() - expiry.getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  el('confirmed').checked = false;
  for(const key of identityFields)identityElement(key).value=(data.identity||identityHint(data.id))[key]||'';
  el('distinctVariant').checked=false;
}
async function loadTarget(preserve = false) {
  const id = el('offerId').value.trim();
  const ticket = selectionGeneration, session = generation;
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error('Choose a valid offer ID first.');
  if(editor.targetLoading)return false;
  editor.targetLoading=true;syncEditor();
  try{
  const offer = await readWithDeadline(client.catalog.offer(id));
  if (ticket !== selectionGeneration || session !== generation || !allowed || el('offerId').value.trim() !== id) return false;
  if (offer?.status === 'published' && !preserve && dirty && !confirm('Replace the current form fields with this published offer?')) return false;
  const savedIdentity=offer?.identityKey?decodeIdentityKey(offer.identityKey):null;
  expectedCatalog = offer?.revision || 0; targetId = id;
  if (offer?.status === 'published' && !preserve) fill(offer);
  editor.published=offer?.status==='published'?offer:null;lockIdentity(!!offer?.identityKey);
  const identity=offer?.identity||savedIdentity?.identity;
  if(identity)for(const key of identityFields)identityElement(key).value=identity[key]||'';
  if(offer?.status==='withdrawn'&&savedIdentity)el('offerType').value=savedIdentity.offerType;
  el('targetStatus').textContent = offer ? `Target revision ${expectedCatalog} (${offer.status}). Publishing will replace this catalog version, not saved plans.` : seedCatalog.some(v=>v.id===id) ? 'This will replace the unreviewed starter entry.' : 'This will create a new public offer.';
  showDuplicates();
  el('confirmed').checked=false;el('distinctVariant').checked=false;
  return true;
  }finally{if(ticket===selectionGeneration&&session===generation){editor.targetLoading=false;syncEditor();}}
}
async function select(item) {
  if (!allowed || !mayLeave()) return;
  resetEditor();
  const ticket = selectionGeneration, session = generation;
  editor.loading=true;syncEditor();showView('editor');
  message('Loading review…');
  try {
    const review = await readWithDeadline(client.catalog.review(item.candidateId));
    if (ticket !== selectionGeneration || session !== generation || !allowed) return;
    selected = item; expectedReview = review?.revision || 0;
    const seedId = item.seed?.id || sourceOffers[item.sourceId];
    const seed = item.seed || seedCatalog.find(v=>v.id===seedId);
    const id = item.offer?.id || review?.publishedId || seed?.id || item.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80);
    fill({ ...(seed || {}), ...item.offer, id, name: item.offer?.name || seed?.name || item.title, url: item.offer?.url || seed?.url || item.url, offerType: item.offer?.offerType || '', trialDays: item.offer?.trialDays || 0, reviewDays: item.offer?.reviewDays || 30 });
    el('notes').value = review?.notes || '';
    el('selection').textContent = `${item.title} · ${review?.status || 'unreviewed'}`;
    const evidence = el('evidence');
    const link = document.createElement('a');
    try { const url = new URL(item.url); if (url.protocol === 'https:' && !url.username && !url.password) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open source evidence ↗'; evidence.append(link); } } catch {}
    const list = document.createElement('ul');
    for (const excerpt of (Array.isArray(item.evidence) ? item.evidence : []).slice(0,6)) { const li = document.createElement('li'); li.textContent = String(excerpt).slice(0,1000); list.append(li); }
    evidence.append(list);
    const credit = document.createElement('p'); credit.textContent = [item.attribution,item.license,item.observedAt].filter(Boolean).join(' · '); evidence.append(credit);
    const audit=starterAudit[seedId||id];
    if(audit){const note=document.createElement('p');note.className='audit-note';note.textContent=`Source audit ${audit.checkedAt} · ${audit.status.replaceAll('_',' ')} (not an approval): ${audit.summary}`;evidence.append(note);const link=document.createElement('a');link.href=audit.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Audited official source ↗';evidence.append(link);}
    if(item.historical){const note=document.createElement('p');note.textContent='Historical version: newer evidence may exist. Publishing this would replace the current listing after your review.';evidence.append(note);}
    const suggestion = draftSuggestions(item);
    const useDraft = !!suggestion && !review && !item.offer;
    if(!await loadTarget(useDraft))return false;
    if (ticket !== selectionGeneration || session !== generation) return;
    if (item.aiDraft || item.draftStatus) {
      if(useDraft){
        applyDraft(suggestion);
        try {const source=new URL(item.url);if(source.protocol==='https:'&&!source.username&&!source.password)el('url').value=source.href;}catch{}
        if(categories.includes(item.categories?.[0]))el('category').value=item.categories[0];
        el('goal').value='Evaluate whether this offer meets your needs within its stated limits.';
      }
      showDraft(item,suggestion,useDraft);
    }
    showDuplicates();
    el('reviewForm').hidden=false;el('sourcePanel').hidden=false;
    dirty = false; message('Check the official terms, complete all required details, then approve or reject.');
    updateSelection();return true;
  } catch (error) { if (session === generation&&ticket===selectionGeneration){message(`Could not load this review: ${error.message}. Select the entry again to retry.`,true);}return false;
  }finally{if(session===generation&&ticket===selectionGeneration){editor.loading=false;syncEditor();}}
}
async function loadQueue(append = false) {
  if (!allowed || busy) return;
  const session = generation, type = el('queueType').value, ticket=++queueGeneration;
  el('refresh').disabled = true; el('more').disabled = true;
  el('queueError').hidden=true;el('queueStatus').textContent='Loading entries…';
  el('queuePanel').setAttribute('aria-busy','true');
  if(type!==loadedType){cursor=null;loadedRows.clear();el('queue').replaceChildren();}
  try {
    let items,nextCursor,hasMore=false;
    if (type === 'collected') {
      const page = await readWithDeadline(client.catalog.candidates(append ? cursor : null));
      if (session !== generation || type !== el('queueType').value || ticket!==queueGeneration) return;
      nextCursor = page.cursor; hasMore = page.more;
      items = page.items.map(item=>({...item,candidateId:item.id}));
    } else if (type === 'seeds') items = seedCatalog.map(seed=>({title:seed.name,url:seed.url,seed,candidateId:`seed-${seed.id}`}));
    else items = catalog.map(offer=>({title:`${offer.name || offer.id} · ${offer.status}`,url:offer.url,offer,candidateId:offer.sourceCandidate || `seed-${offer.id}`}));
    const reviewed = await readWithDeadline(Promise.all(items.map(async item => ({ item, review: await client.catalog.review(item.candidateId) }))));
    if (session !== generation || type !== el('queueType').value || ticket!==queueGeneration || !allowed) return;
    if(!append)loadedRows.clear();
    for(const row of reviewed)loadedRows.set(rowKey(row.item),row);
    cursor=nextCursor;loadedType=type;el('more').hidden=!hasMore;
    renderQueue();
  } catch(error) { if(session===generation&&ticket===queueGeneration){el('queueError').textContent=`Could not load entries: ${error.message}. Use Refresh to retry; your review edits are kept.`;el('queueError').hidden=false;el('queueStatus').textContent='Unable to refresh. Previously loaded entries, if any, remain available.';} }
  finally { if(ticket===queueGeneration){el('refresh').disabled = false; el('more').disabled = false;el('queuePanel').setAttribute('aria-busy','false');} }
}
function renderQueue(){
    const type=el('queueType').value, pendingOnly=el('reviewFilter').value==='pending';
    const scroll=el('queue').scrollTop, focused=document.activeElement?.dataset?.rowKey;
    el('queue').replaceChildren();
    const rows=loadedType===type?[...loadedRows.values()]:[];
    const search=el('queueSearch').value.trim().toLowerCase();visibleItems=[];
    const groups=type==='collected'?groupCandidates(rows):rows.map(v=>({current:v,history:[],pending:!v.review&&!(v.item.seed&&catalog.some(c=>c.id===v.item.seed.id&&c.status==='published'))?1:0}));
    for (const group of groups) {
      if(pendingOnly&&!group.pending)continue;
      const {item,review}=group.current;
      if(search&&![group.current,...group.history].some(({item:v})=>[v.title,v.candidateId,v.url,v.offer?.id,v.seed?.id,v.sourceId,v.offer?.identity?.provider].filter(Boolean).join(' ').toLowerCase().includes(search)))continue;
      visibleItems.push(item);
      const row = document.createElement('div');
      row.className='offer-group';
      const published=item.seed&&catalog.some(v=>v.id===item.seed.id&&v.status==='published');
      const status=item.offer?item.offer.status:review?.status || (published?'published':'needs review');
      const open=button(`${item.title} — ${status}`,()=>select(item));open.dataset.rowKey=rowKey(item);row.append(open);
      const date = document.createElement('small'); date.textContent = item.observedAt ? `Collected ${item.observedAt}${item.aiDraft ? ' · AI draft available (unverified)' : ''}` : item.seed ? 'Starter entry: confirm every term before approval.' : `Catalog revision ${item.offer?.revision || 0}`; row.append(date);
      if (item.offer?.status === 'published') row.append(button(`Withdraw ${item.offer.name}`,()=>withdraw(item.offer)));
      if(item.seed&&starterAudit[item.seed.id]){const p=document.createElement('small');p.textContent=`Audit: ${starterAudit[item.seed.id].status.replaceAll('_',' ')}`;row.append(p);}
      if(group.history.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${group.history.length} older / related version(s)`;details.append(summary);details.open=expanded.has(group.key);details.addEventListener('toggle',()=>{if(!details.isConnected)return;if(details.open)expanded.add(group.key);else expanded.delete(group.key);});for(const prior of group.history){const open=button(`History: ${prior.item.title} · ${prior.review?.status||'unreviewed evidence'} · ${prior.item.observedAt||''}`,()=>select({...prior.item,historical:true}));open.dataset.rowKey=rowKey(prior.item);details.append(open);}row.append(details);}
      el('queue').append(row);
    }
    el('queueStatus').textContent = `${visibleItems.length} offer groups from ${rows.length} loaded records.${type==='collected'?' Load older versions to search more evidence.':''}`;
    if(!visibleItems.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent=search?'No matches in loaded entries. Change the search or load more.':pendingOnly?'No pending entries in this view. Choose All offer groups or load more.':'No entries loaded. Try another source or Refresh.';el('queue').append(empty);}
    updateSelection();el('queue').scrollTop=scroll;
    if(focused){const next=[...el('queue').querySelectorAll('[data-row-key]')].find(v=>v.dataset.rowKey===focused);next?.focus({preventScroll:true});}
}
async function decide(decision) {
  if (!allowed || !selected || busy || editor.loading || editor.targetLoading || el('reviewForm').hidden) return;
  if(!navigator.onLine){message('You appear to be offline. Your edits are kept. Reconnect, then explicitly submit again; decisions are not queued.',true);return;}
  if (decision === 'approved' && !validateForm()) return;
  if (decision === 'rejected' && !el('notes').value.trim()) { message('Add a private reason before rejecting.',true); el('notes').focus(); return; }
  if (!confirm(decision === 'approved' ? `Publish ${el('name').value} to all visitors now? Existing saved plans will not change.` : 'Reject this candidate? This does not withdraw an already-published offer.')) return;
  const session = generation;
  busy = true; syncEditor();
  try {
    const id = el('offerId').value.trim();
    if (decision === 'approved' && targetId !== id) throw new Error('Load this existing offer (or new ID) before publishing.');
    const offer = {id,currency:'USD',expiresAt:el('expiresAt').value ? new Date(el('expiresAt').value).toISOString() : null};
    offer.identity=readIdentity();
    for (const key of textKeys) offer[key] = el(key).value;
    for (const key of numberKeys) offer[key] = Number(el(key).value);
    await client.catalog.decide({candidateId:selected.candidateId,expectedReview,expectedCatalog,offer,decision,notes:el('notes').value.trim(),distinctVariant:el('distinctVariant').checked});
    if (session!==generation) return;
    parked.delete(rowKey(selected));renderParked();resetEditor();showView('queue');message(decision === 'approved' ? 'Published. Visitors will receive the approved offer without a redeploy.' : 'Rejected. Nothing was published.');
  } catch(error) { if(session===generation) message(`${error.message} Your edits are kept. Check / load the target or reopen the review after keeping a tab draft if a revision changed.`,true); }
  finally { busy = false; syncEditor(); if(session===generation && allowed) void loadQueue(); }
}
async function withdraw(offer) {
  if (!allowed || !mayLeave() || !confirm(`Withdraw ${offer.name} from discovery? Existing user plans stay unchanged.`)) return;
  if(!navigator.onLine){message('Reconnect before withdrawing. This action has not been queued.',true);return;}
  const session = generation; busy=true;syncEditor();
  try { await client.catalog.withdraw(offer.id,offer.revision); if(session===generation) { resetEditor();showView('queue'); message('Withdrawn from the public feed. Saved plans are unchanged.'); } }
  catch(error) { if(session===generation) message(error.message,true); }
  finally { busy=false;syncEditor(); if(session===generation && allowed) void loadQueue(); }
}
function renderParked(){
  el('parkedDrafts').replaceChildren();el('parkedPanel').hidden=!parked.size;
  for(const [key,draft] of parked){
    el('parkedDrafts').append(button(`Resume draft: ${draft.values.name||draft.item.title}`,async()=>{
      if(!allowed||busy)return;
      if(!await select(draft.item))return;
      for(const [id,value]of Object.entries(draft.values))el(id).value=value;
      expectedReview=draft.expectedReview;expectedCatalog=draft.expectedCatalog;targetId=draft.targetId;
      editor.published=draft.published;lockIdentity(draft.locked);setDirty();showDuplicates();
      el('targetStatus').textContent=`Restored target ${targetId||'not checked'} at revision ${expectedCatalog}. Original revision checks still apply.`;
      message('Draft restored in this tab. Review the fields and check the target if it changed; publication still requires confirmation.');
    }),button(`Discard kept draft: ${draft.values.name||draft.item.title}`,()=>{if(!allowed||busy||!confirm('Discard this kept draft?'))return;parked.delete(key);renderParked();}));
  }
}
function parkDraft(){
  if(!allowed||!selected||busy||editor.loading||editor.targetLoading||el('reviewForm').hidden)return;
  const key=rowKey(selected);
  if(parked.size>=10&&!parked.has(key)){message('This tab already holds 10 drafts. Resume or discard one before keeping another.',true);return;}
  const values=Object.fromEntries([...el('reviewForm').querySelectorAll('input,select,textarea')].filter(v=>!['confirmed','distinctVariant'].includes(v.id)).map(v=>[v.id,v.value]));
  parked.set(key,{item:selected,values,expectedCatalog,expectedReview,targetId,published:editor.published,locked:editor.locked});
  resetEditor();renderParked();el('parkedPanel').open=true;showView('queue');message('Draft kept in this tab only. Refreshing, closing this tab, or signing out clears it.');
}
function connectionStatus(){el('connection').textContent=navigator.onLine?'Network available · decisions require a server check':'Offline · edits stay in this tab; decisions are not queued';}
const categoryLabels={devtools:'Developer tools',cloudinfra:'Cloud infrastructure',aiapis:'AI APIs',harnesses:'Local AI tools',design:'Design',family:'Family',productivity:'Productivity',learning:'Learning',home:'Home',shows:'TV & streaming',health:'Health',finance:'Finance',meals:'Meals',delivery:'Delivery',services:'Services'};
for (const category of categories) el('category').add(new Option(categoryLabels[category]||category,category));
for (const [key,label] of Object.entries(offerTypes)) el('offerType').add(new Option(label,key));
for (const seed of seedCatalog) { const option=document.createElement('option'); option.value=seed.id; option.label=seed.name; el('offerIds').append(option); }
el('offerType').onchange=()=>{ if(el('offerType').value!=='trial') el('trialDays').value='0'; };
el('reviewForm').oninput=event=>{dirty=true;if(event.target.id!=='confirmed'&&event.target.id!=='distinctVariant'){setDirty();showDuplicates();}syncEditor();const input=event.target;if(input.validity?.valid){input.removeAttribute('aria-invalid');input.removeAttribute('aria-errormessage');el(`error-${input.id}`)?.remove();}};
el('offerId').oninput=()=>{targetId='';lockIdentity(false);el('targetStatus').textContent='Check / load this ID before publishing.';};
el('loadTarget').onclick=async()=>{if(busy||editor.loading||editor.targetLoading)return;try{if(await loadTarget()){setDirty();message('Target loaded. Recheck its details before approving.');}}catch(error){message(error.message,true);}};
el('newVariant').onclick=()=>{if(busy||editor.loading||editor.targetLoading)return;el('offerId').value='';targetId='';expectedCatalog=0;editor.published=null;lockIdentity(false);setDirty();el('targetStatus').textContent='Choose a new offer ID and change the identity for this distinct variant, then check the ID.';showDuplicates();el('offerId').focus();};
el('reviewForm').onsubmit=event=>{event.preventDefault();void decide('approved');};
el('reject').onclick=()=>decide('rejected');
el('cancel').onclick=()=>{if(mayLeave()){resetEditor();showView('queue');}};
el('backToQueue').onclick=()=>showView('queue');
el('resumeCurrent').onclick=()=>showView('editor');
el('parkDraft').onclick=parkDraft;
el('refresh').onclick=()=>loadQueue(); el('more').onclick=()=>loadQueue(true);
el('queueType').onchange=()=>loadQueue();
el('reviewFilter').onchange=()=>renderQueue();
el('queueSearch').oninput=()=>renderQueue();
window.addEventListener('offline',connectionStatus);window.addEventListener('online',connectionStatus);connectionStatus();
window.addEventListener('beforeunload',event=>{if(dirty||busy||parked.size){event.preventDefault();event.returnValue='';}});
el('signIn').onclick=async()=>{try{await client.signIn();}catch{message('Sign-in did not finish. Allow the Google popup and try again.',true);}};
el('signOut').onclick=async()=>{if(mayLeave()&&(!parked.size||confirm('Signing out clears every draft kept in this tab. Continue?'))){try{await client.signOut();}catch{message('Sign-out failed. Try again.',true);}}};
try {
  client=await createFirebaseClient(config,{emulator});
  el('signIn').disabled=false;
  client.onAuth(async user=>{
    const session=++generation; allowed=false; queueGeneration++;loadedRows.clear();loadedType='';parked.clear();expanded.clear();renderParked(); stopCatalog?.(); stopCatalog=null; catalog=[]; resetEditor(); el('queue').replaceChildren();el('queueSearch').value='';el('queueError').hidden=true;el('workspace').dataset.view='queue'; el('workspace').hidden=true; message('');
    el('identity').textContent=user ? `Signed in as ${user.email || 'your account'}. Checking admin access…` : 'Sign in with the project owner’s Google account.';
    el('signIn').hidden=!!user;el('signOut').hidden=!user;
    if(!user)return;
    try {
      const admin=await client.catalog.checkAdmin();
      if(session!==generation)return;
      allowed=admin;
      el('identity').textContent=admin ? `Admin: ${user.email}` : 'This account is not authorized to review or publish offers.';
      el('workspace').hidden=!admin;
      if(admin){stopCatalog=client.catalog.watchCatalog(items=>{if(session!==generation||!allowed)return;catalog=items;showCoverage();showRevisionNotice();if(selected)showDuplicates();if(el('queueType').value==='published')void loadQueue();else renderQueue();},()=>{if(session===generation)message('Catalog unavailable. Refresh when online; your edits are kept.',true);});void loadQueue();}
    }catch{if(session===generation)message('Could not verify admin access. Check your connection and reload.',true);}
  });
} catch { el('identity').textContent='Connection unavailable. Check your connection and reload.'; }

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {identityKey} from '../offer-identity.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const browser=await chromium.launch();
const errors=[];
const mock=`export async function createFirebaseClient(){
 const s=window.fixture;s.pending=[];
 return {onAuth(cb){s.auth=cb;queueMicrotask(()=>cb({uid:'owner',email:'owner@example.com'}));},signIn(){},signOut(){s.auth(null);},catalog:{
 checkAdmin:async()=>true,
 watchCatalog(cb){s.emit=()=>cb(s.catalog);queueMicrotask(s.emit);return ()=>{};},
 candidates:async cursor=>{if(s.queueError)throw new Error('Simulated queue failure');const start=cursor||0;return {items:s.candidates.slice(start,start+25),cursor:start+25,more:start+25<s.candidates.length};},
 review:async id=>s.reviews[id]||null,
 offer:async id=>{if(s.defer)await new Promise(resolve=>s.pending.push({id,resolve}));if(s.offerError)throw new Error('Simulated target failure');return s.catalog.find(v=>v.id===id)||null;},
 decide:async data=>{if(s.writeError)throw new Error(s.writeError);s.writes.push(data);},withdraw:async()=>{}
 }};}`;
function offer(id,name){const result={id,name,status:'published',revision:1,sourceCandidate:'shared',description:'Published description',category:'devtools',url:'https://example.com/'+id,offerType:'free_tier',trialDays:0,reviewDays:30,monthlyValue:0,upfrontCost:0,currency:'USD',priceDetails:'Limited free use',eligibility:'New users',region:'United States',cancellation:'Cancel in settings',goal:'Try one project',expiresAt:null,identity:{provider:'example',product:id,plan:'free',region:'us',scope:'general'}};result.identityKey=identityKey(result);return result;}
const candidate=(id,title)=>({id,title,url:'https://example.com/'+id,observedAt:'2026-09-09T00:00:00Z'});
const aiCandidate={...candidate('one','Candidate one'),sourceId:'github-copilot-plans',evidenceUrl:'https://example.com/one',aiDraft:{schemaVersion:1,status:'unverified',provider:'ollama-local',model:'fixture-local',sourceUrl:'https://example.com/one',fields:{name:{value:'AI offer',quote:'Free offer <img src=x onerror=alert(1)>'},description:{value:'Suggested description',quote:'Free offer'},offerType:{value:'free_tier',quote:'Free offer'}}}};
async function pageFor(extra={}){
 const page=await browser.newPage();const decisions=[],dialogs=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>{dialogs.push(dialog.message());const accept=decisions.length?decisions.shift():true;return accept?dialog.accept():dialog.dismiss();});
 await page.addInitScript(state=>window.fixture=state,{catalog:[],candidates:[],reviews:{},writes:[],...extra});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='audit.local')return route.abort();
  if(url.pathname==='/firebase-client.mjs')return route.fulfill({contentType:'application/javascript',body:mock});
  if(!/^\/[a-zA-Z0-9._-]+$/.test(url.pathname))return route.fulfill({status:404,body:''});
  try{await route.fulfill({contentType:url.pathname.endsWith('.html')?'text/html':url.pathname.endsWith('.css')?'text/css':'application/javascript',body:await readFile(root+url.pathname.slice(1))});}catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('http://audit.local/admin.html');await page.locator('#workspace').waitFor({state:'visible'});
 return {page,decisions,dialogs};
}
async function ready(page){await page.waitForFunction(()=>!document.getElementById('reviewForm').hidden&&!document.getElementById('fields').disabled);}
async function resolveNext(page){await page.evaluate(()=>window.fixture.pending.shift().resolve());}
try{
 // Delayed loading, cancellation and out-of-order responses.
 const {page}=await pageFor({defer:true,catalog:[offer('github-copilot','Existing Copilot')],candidates:[aiCandidate,candidate('two','Candidate two')]});
 await page.getByRole('button',{name:'Candidate one — needs review',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.pending.length===1);
 assert.equal(await page.locator('#reviewForm').isVisible(),false);assert.equal(await page.locator('#name').isDisabled(),true);
 await page.locator('#cancel').click();await resolveNext(page);
 assert.equal(await page.locator('#message').textContent(),'');assert.equal(await page.locator('#reviewForm').isVisible(),false);
 await page.getByRole('button',{name:'Candidate one — needs review',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.pending.length===1);
 await page.getByRole('button',{name:'Candidate two — needs review',exact:true}).click();
 await page.waitForFunction(()=>window.fixture.pending.length===2);
 await page.evaluate(()=>window.fixture.pending.pop().resolve());await ready(page);
 await page.locator('#name').fill('My current edit');await resolveNext(page);
 assert.equal(await page.locator('#name').inputValue(),'My current edit');assert.match(await page.locator('#saveStatus').textContent(),/Unsaved/);
 await page.close();
 const ai=await pageFor({catalog:[offer('github-copilot','Existing Copilot')],candidates:[aiCandidate]});
 await ai.page.getByRole('button',{name:'Candidate one — needs review',exact:true}).click();await ready(ai.page);
 assert.equal(await ai.page.locator('#name').inputValue(),'AI offer');assert.equal(await ai.page.locator('#draftInfo img').count(),0);
 await ai.page.locator('#name').fill('Keep my name');await ai.page.locator('#confirmed').check();
 await ai.page.getByText('Compare source suggestion for Description',{exact:true}).click();
 await ai.page.getByRole('button',{name:'Apply Description suggestion',exact:true}).click();
 assert.equal(await ai.page.locator('#name').inputValue(),'Keep my name');assert.equal(await ai.page.locator('#description').inputValue(),'Suggested description');
 assert.equal(await ai.page.locator('#confirmed').isChecked(),false);await ai.page.close();

 // Shared source candidates must not collapse published rows or retarget selection.
 const split=await pageFor({catalog:[offer('beta','Beta'),offer('alpha','Alpha')],reviews:{shared:{revision:2,status:'approved',publishedId:'beta'}}});
 await split.page.locator('#queueType').selectOption('published');
 await split.page.getByRole('button',{name:'Alpha · published — published',exact:true}).click();await ready(split.page);
 assert.equal(await split.page.locator('#queue>.offer-group').count(),2);
 assert.equal(await split.page.locator('#offerId').inputValue(),'alpha');assert.equal(await split.page.locator('#name').inputValue(),'Alpha');
 assert.equal(await split.page.locator('#identityRegion').getAttribute('readonly'),'');
 assert.equal(await split.page.locator('#queue [aria-current=true]').count(),1);
 // Canceled reload, canceled navigation, failed publication and conflict notification preserve edits.
 await split.page.locator('#name').fill('Carefully edited Alpha');
 split.decisions.push(false);await split.page.locator('#loadTarget').click();
 await split.page.waitForFunction(()=>!document.getElementById('fields').disabled);
 assert.equal(await split.page.locator('#name').inputValue(),'Carefully edited Alpha');
 split.decisions.push(false);await split.page.getByRole('button',{name:'Beta · published — published',exact:true}).click();
 assert.equal(await split.page.locator('#offerId').inputValue(),'alpha');
 await split.page.evaluate(()=>window.fixture.writeError='This offer changed in another tab.');
 await split.page.locator('#confirmed').check();await split.page.locator('#publish').click();
 await split.page.waitForFunction(()=>document.getElementById('editorError').textContent.includes('Your edits are kept'));
 assert.equal(await split.page.locator('#name').inputValue(),'Carefully edited Alpha');
 assert.equal(await split.page.locator('#name').isDisabled(),false);
 assert.equal(await split.page.locator('#editorError').evaluate(v=>document.activeElement===v),true);
 await split.page.evaluate(()=>{window.fixture.catalog.find(v=>v.id==='alpha').revision=2;window.fixture.emit();});
 await split.page.locator('#revisionNotice').waitFor({state:'visible'});
 assert.equal(await split.page.locator('#name').inputValue(),'Carefully edited Alpha');
 // Explicitly kept drafts live only in this authenticated tab and retain original revisions.
 await split.page.locator('#notes').fill('Private fixture note');await split.page.locator('#parkDraft').click();
 await split.page.getByRole('button',{name:'Resume draft: Carefully edited Alpha',exact:true}).click();await ready(split.page);
 assert.equal(await split.page.locator('#notes').inputValue(),'Private fixture note');assert.equal(await split.page.locator('#confirmed').isChecked(),false);
 assert.equal(await split.page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await split.page.locator('#signOut').click();await split.page.locator('#workspace').waitFor({state:'hidden'});
 assert.equal(await split.page.locator('#parkedDrafts').textContent(),'');assert.equal(await split.page.locator('#notes').inputValue(),'');
 await split.page.close();
 const withdrawn=await pageFor({catalog:[{id:'alpha',status:'withdrawn',revision:2,identityKey:offer('alpha','Alpha').identityKey}]});
 await withdrawn.page.locator('#queueType').selectOption('published');
 await withdrawn.page.getByRole('button',{name:'alpha · withdrawn — withdrawn',exact:true}).click();await ready(withdrawn.page);
 assert.equal(await withdrawn.page.locator('#identityRegion').inputValue(),'us');
 assert.equal(await withdrawn.page.locator('#identityRegion').getAttribute('readonly'),'');
 assert.equal(await withdrawn.page.locator('#offerType').inputValue(),'free_tier');await withdrawn.page.close();

 // Realistic queue sizes, page loads, search, mobile list/detail and validation.
 const many=await pageFor({candidates:Array.from({length:100},(_,i)=>candidate('item-'+i,'Queue item '+i))});
 await many.page.waitForFunction(()=>document.querySelectorAll('#queue>.offer-group').length===25);
 for(const count of [50,75,100]){await many.page.locator('#more').click();await many.page.waitForFunction(count=>document.querySelectorAll('#queue>.offer-group').length===count,count);}
 await many.page.locator('#queueSearch').fill('Queue item 99');assert.equal(await many.page.locator('#queue>.offer-group').count(),1);
 await many.page.getByRole('button',{name:'Queue item 99 — needs review',exact:true}).click();await ready(many.page);
 await many.page.locator('#publish').click();assert.match(await many.page.locator('#editorError').textContent(),/Check the highlighted/);
 assert.equal(await many.page.locator('#name').getAttribute('aria-invalid'),null);
 assert.equal(await many.page.locator('#description').getAttribute('aria-invalid'),'true');
 await many.page.locator('#editorError').getByRole('button',{name:'Region identifier',exact:true}).click();
 assert.equal(await many.page.locator('#identityDetails').getAttribute('open'),'');
 assert.equal(await many.page.locator('#identityRegion').evaluate(v=>document.activeElement===v),true);
 for(const width of [390,360]){
  await many.page.setViewportSize({width,height:844});
  assert.equal(await many.page.locator('#queuePanel').isVisible(),false);
  assert(await many.page.locator('#editorPanel').evaluate(v=>v.getBoundingClientRect().top+scrollY<400));
  assert(await many.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await many.page.locator('#backToQueue').click();assert.equal(await many.page.locator('#editorPanel').isVisible(),false);
  await many.page.locator('#resumeCurrent').click();assert.equal(await many.page.locator('#editorPanel').isVisible(),true);
 }
 await many.page.screenshot({path:'/private/tmp/trywise-admin-fixed-mobile.png',fullPage:true});
 await many.page.locator('#cancel').click();await many.page.locator('#queueType').selectOption('seeds');
 await many.page.locator('#queueSearch').fill('');await many.page.waitForFunction(()=>document.querySelectorAll('#queue>.offer-group').length===35);
 await many.page.getByRole('button',{name:/Notion Plus — needs review/}).click();await ready(many.page);
 assert(await many.page.locator('#editorPanel').evaluate(v=>v.getBoundingClientRect().top+scrollY<400));
 await many.page.setViewportSize({width:1440,height:900});
 await many.page.screenshot({path:'/private/tmp/trywise-admin-fixed-desktop.png',fullPage:true});
 assert(await many.page.locator('#queuePanel').evaluate(v=>v.getBoundingClientRect().height<=innerHeight));
 for(const width of [1440,390]){
  await many.page.setViewportSize({width,height:900});
  for(const id of ['name','category','monthlyValue','region','notes','confirmed']){
   await many.page.locator('#'+id).focus();
   const position=await many.page.locator('#'+id).evaluate(v=>{const field=v.getBoundingClientRect(),bar=document.querySelector('.action-bar').getBoundingClientRect();return {bottom:field.bottom,top:field.top,bar:bar.top};});
   assert(position.top>=0&&position.bottom<=position.bar+1,`${id} must not be covered by the action bar at ${width}px: ${JSON.stringify(position)}`);
  }
 }
 await many.page.setViewportSize({width:1440,height:900});
 // Queue failures are visible and retryable, leaving editor data intact.
 await many.page.locator('#name').fill('Keep through queue failure');
 await many.page.evaluate(()=>window.fixture.queueError=true);await many.page.locator('#queueType').selectOption('collected');
 await many.page.locator('#queueError').waitFor({state:'visible'});assert.equal(await many.page.locator('#refresh').isDisabled(),false);
 assert.equal(await many.page.locator('#name').inputValue(),'Keep through queue failure');
 await many.page.evaluate(()=>window.fixture.queueError=false);await many.page.locator('#refresh').click();
 await many.page.waitForFunction(()=>document.querySelectorAll('#queue>.offer-group').length===25);
 // Browser offline hint: no silent queued publication.
 await many.page.context().setOffline(true);await many.page.locator('#publish').click();
 assert.match(await many.page.locator('#editorError').textContent(),/offline/);assert.equal(await many.page.evaluate(()=>window.fixture.writes.length),0);
 await many.page.context().setOffline(false);await many.page.close();
 assert.deepEqual(errors,[]);
 console.log('Admin regressions passed: delayed/canceled/out-of-order loads, shared-source selections, edit preservation, conflicts, tab drafts, privacy clearing, 100-record pagination, 35 starters, search, mobile navigation, validation, retry and offline safeguards.');
}finally{await browser.close();}

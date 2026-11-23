// One-time, owner-requested operator review. NOT a scheduled verifier.
// Evidence: review-notes/catalog-2026-10-24.md. No provider signup or payment.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateOffer } from '../catalog-model.mjs';
import { identityKey } from '../offer-identity.mjs';

export const root = 'projects/trywise-9f8e1/databases/(default)/documents';
export const checkedDate = '2026-10-24';
export const reviews = [
  { id:'cloudflare-workers', revision:2, type:'free_tier',
    identity:{provider:'cloudflare',product:'workers',plan:'free',region:'global',scope:'general'},
    sourceId:'cloudflare-workers-pricing', url:'https://developers.cloudflare.com/workers/platform/pricing/',
    evidence:'Workers Free remains available with 100,000 requests/day and 10 ms CPU per invocation. Paid plans and other products are separate. No provider expiry stated.',
    patch:{} },
  { id:'github-copilot', revision:3, type:'free_tier',
    identity:{provider:'github',product:'copilot',plan:'free',region:'global',scope:'general'},
    sourceId:'github-copilot-plans', url:'https://docs.github.com/en/copilot/get-started/plans',
    evidence:'Copilot Free remains a no-cost limited plan for individuals without organization/enterprise Copilot access. Paid plans are separate; no fixed duration or provider expiry stated.',
    patch:{} },
  { id:'adobe-express', revision:3, type:'trial',
    identity:{provider:'adobe',product:'express',plan:'premium',region:'us',scope:'general'},
    sourceId:'adobe-express-official', url:'https://www.adobe.com/express/pricing',
    evidence:'US individual Express Premium: 30-day free trial, US$9.99/month, no annual commitment. Billing starts after trial and renews until canceled. Cancel before trial ends to avoid charges. No provider expiry stated.',
    patch:{url:'https://www.adobe.com/express/pricing',trialDays:30,monthlyValue:9.99,upfrontCost:0,
      priceDetails:'US$9.99/month after a 30-day free trial; monthly billing with no annual commitment. Confirm any applicable tax at checkout.',
      eligibility:'Individual Adobe account; confirm trial eligibility and any previous-trial restrictions at signup.',
      cancellation:'Cancel before the free trial ends to avoid charges. Billing begins after the trial; the subscription automatically renews until canceled. No refund guarantee is asserted here.'} },
  { id:'canva-pro', revision:1, type:'trial', sourceId:'manual-canva-pro',
    url:'https://www.canva.com/pricing/',
    evidence:'Canva advertises a Pro trial and US$144/year for one person on the public annual view. Trial duration and the current monthly checkout price were not confirmed. Existing $180/year claim conflicts with the public page. Do not refresh verifiedAt or infer trial length.',
    patch:null },
];
const candidateId = item => `recheck-20261024-${item.id}`;
const time = fieldPath => ({fieldPath,setToServerValue:'REQUEST_TIME'});
function value(v) {
  if(v===null)return {nullValue:null};
  if(typeof v==='string')return {stringValue:v};
  if(typeof v==='number' && Number.isFinite(v))return Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(Array.isArray(v))return {arrayValue:{values:v.map(value)}};
  if(v && typeof v==='object')return {mapValue:{fields:fields(v)}};
  throw Error('Unsupported Firestore value');
}
function fields(object){return Object.fromEntries(Object.entries(object).map(([k,v])=>[k,value(v)]));}
export function decode(document){
  function read(v){
    if('stringValue' in v)return v.stringValue;
    if('timestampValue' in v)return v.timestampValue;
    if('integerValue' in v)return Number(v.integerValue);
    if('doubleValue' in v)return v.doubleValue;
    if('nullValue' in v)return null;
    if('mapValue' in v)return decode({fields:v.mapValue.fields});
    if('arrayValue' in v)return (v.arrayValue.values||[]).map(read);
    throw Error('Unsupported existing value');
  }
  return Object.fromEntries(Object.entries(document.fields||{}).map(([k,v])=>[k,read(v)]));
}
export function documentPaths(){
  return reviews.flatMap(item=>[
    `${root}/catalog/${item.id}`,`${root}/candidates/${candidateId(item)}`,`${root}/candidateReviews/${candidateId(item)}`,
    ...(item.patch ? [`${root}/offerKeys/${identityKey({identity:item.identity,offerType:item.type,currency:'USD'})}`] : []),
  ]);
}
export function buildRecheckWrites(documents, now=new Date(), reviewer='operator:owner-requested-assistant-review'){
  if(!Number.isFinite(now.getTime()) || now.toISOString().slice(0,10)!==checkedDate)throw Error('Evidence window expired; recheck sources again.');
  const writes=[];
  for(const item of reviews){
    const path=`${root}/catalog/${item.id}`, previous=documents.get(path);
    if(!previous?.updateTime)throw Error(`Missing existing offer: ${item.id}`);
    const old=decode(previous), id=candidateId(item), candidatePath=`${root}/candidates/${id}`, reviewPath=`${root}/candidateReviews/${id}`;
    if(old.id!==item.id || old.status!=='published' || old.revision!==item.revision || old.offerType!==item.type || old.currency!=='USD')throw Error(`Offer changed; stop for new review: ${item.id}`);
    if(old.expiresAt!==null)throw Error('An expiry requires a new review.');
    if(documents.has(candidatePath)||documents.has(reviewPath))throw Error('Review already exists; do not replay.');
    const payload={id,sourceId:item.sourceId,title:`${old.name} — 2026-10-24 source recheck`,url:item.url,evidenceUrl:item.url,
      sourceUrl:item.url,observedAt:now.toISOString(),status:'pending_review',evidence:[item.evidence],
      note:'Assistant checked public official pages at owner request; no human checkbox, signup, trial or purchase is claimed.'};
    writes.push({update:{name:candidatePath,fields:fields({id,schemaVersion:1,status:'pending_review',observedAt:now.toISOString(),payloadJson:JSON.stringify(payload)})},currentDocument:{exists:false}});
    if(!item.patch)continue; // Canva remains stale and gets only a pending review observation.
    const data=validateOffer({...old,...item.patch,identity:item.identity},now.getTime());
    const key=identityKey(data);
    if(old.identityKey && old.identityKey!==key)throw Error('Existing identity cannot change.');
    // Legacy free-plan records are upgraded to explicit identities without changing type/cost.
    if(item.type==='free_tier' && (old.monthlyValue!==0 || old.upfrontCost!==0 || old.trialDays!==0))throw Error('Unexpected free-plan pricing.');
    const keyPath=`${root}/offerKeys/${key}`, reservation=documents.get(keyPath);
    if(reservation && decode(reservation).offerId!==item.id)throw Error('Identity reserved for another offer.');
    if(!reservation)writes.push({update:{name:keyPath,fields:fields({offerId:item.id,schemaVersion:1})},currentDocument:{exists:false},updateTransforms:[time('createdAt')]});
    writes.push({update:{name:path,fields:fields({...data,identityKey:key,sourceCandidate:id,status:'published',revision:old.revision+1,schemaVersion:1})},
      currentDocument:{updateTime:previous.updateTime},updateTransforms:[time('verifiedAt'),time('updatedAt')]});
    writes.push({update:{name:reviewPath,fields:fields({candidateId:id,status:'approved',publishedId:item.id,notes:`2026-10-24 owner-requested assistant source review: ${item.url} . ${item.evidence} No signup or purchase; regional/account eligibility remains subject to provider confirmation.`,reviewedBy:reviewer,revision:1,schemaVersion:1})},currentDocument:{exists:false},updateTransforms:[time('reviewedAt')]});
  }
  return writes;
}
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1 || !['--inspect','--apply'].includes(args[0]))throw Error('Use --inspect or --apply.');
  const base=process.env.FIREBASE_TOOLS_DIR;
  if(!base)throw Error('Set FIREBASE_TOOLS_DIR to the existing installed CLI.');
  const require=createRequire(import.meta.url),auth=require(resolve(base,'lib/auth.js'));
  const account=auth.getGlobalDefaultAccount();
  if(account?.user?.email!=='sohan2405@gmail.com')throw Error('Expected existing owner CLI login.');
  const options={project:'trywise-9f8e1',nonInteractive:true};
  auth.setActiveAccount(options,account);
  await require(resolve(base,'lib/requireAuth.js')).requireAuth(options);
  const token=await require(resolve(base,'lib/apiv2.js')).getAccessToken();
  async function api(suffix,body){
    const response=await fetch(`https://firestore.googleapis.com/v1/${root}${suffix}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Error(`Firestore ${suffix}: ${response.status}; no automatic retry.`);
    return response.json();
  }
  const {transaction}=await api(':beginTransaction',{options:{readWrite:{}}});
  let committed=false;
  try{
    const rows=await api(':batchGet',{documents:documentPaths(),transaction});
    const documents=new Map(rows.filter(row=>row.found).map(row=>[row.found.name,row.found]));
    const writes=buildRecheckWrites(documents);
    console.log(JSON.stringify({approved:reviews.filter(item=>item.patch).map(item=>item.id),pending:['canva-pro'],writes:writes.length,mode:args[0]}));
    if(args[0]==='--inspect')return;
    const result=await api(':commit',{transaction,writes});
    committed=true;
    console.log(JSON.stringify({commitTime:result.commitTime,writeResults:result.writeResults.length}));
  }finally{if(!committed)await api(':rollback',{transaction}).catch(()=>{});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){main().catch(error=>{console.error(error.message);process.exitCode=1;});}

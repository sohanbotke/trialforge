// Read only the public catalog while the account SDK loads. Never cache a plan,
// approve an offer, or publish a partial snapshot (which could omit tombstones).
const MAX_RECORDS = 500;
const MAX_BYTES = 1024 * 1024;

function decode(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) throw Error('Invalid catalog value');
  if ('nullValue' in value) return null;
  if (typeof value.stringValue === 'string') return value.stringValue;
  if (typeof value.timestampValue === 'string') return value.timestampValue;
  if (typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (typeof value.integerValue === 'string' && /^-?\d+$/.test(value.integerValue)) {
    const number=Number(value.integerValue);
    if (Number.isSafeInteger(number)) return number;
  }
  if (typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)) return value.doubleValue;
  if (value.mapValue && typeof value.mapValue === 'object') {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key,item])=>[key,decode(item,depth+1)]));
  }
  if (value.arrayValue && typeof value.arrayValue === 'object') {
    const values=value.arrayValue.values || [];
    if (Array.isArray(values)) return values.map(item=>decode(item,depth+1));
  }
  throw Error('Unsupported catalog value');
}

export async function readPublicCatalog(projectId, {fetcher=fetch, signal} = {}) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '')) throw Error('Invalid project ID');
  const prefix=`projects/${projectId}/databases/(default)/documents/catalog/`;
  // This is the same anonymous collection already permitted by Firestore rules.
  // A server-imposed page boundary is a fallback, never permission to render part.
  const response=await fetcher(`https://firestore.googleapis.com/v1/${prefix.slice(0,-1)}?pageSize=501`, {
    signal, credentials:'omit', cache:'no-store', redirect:'error'
  });
  if (!response.ok || !response.body) throw Error('Catalog startup read unavailable');
  const reader=response.body.getReader(), chunks=[];
  let length=0;
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      length+=value.byteLength;
      if (length>MAX_BYTES) throw Error('Catalog startup payload exceeds budget');
      chunks.push(value);
    }
  } catch(error) { await reader.cancel().catch(()=>{}); throw error; }
  finally { reader.releaseLock(); }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const body=JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body!=='object' || Array.isArray(body) || body.nextPageToken
    || (body.documents!==undefined && !Array.isArray(body.documents))) throw Error('Incomplete catalog snapshot');
  const documents=body.documents || [];
  if (documents.length>MAX_RECORDS) throw Error('Catalog startup count exceeds budget');
  const seen=new Set();
  return documents.map(document=>{
    if (typeof document.name!=='string' || !document.name.startsWith(prefix)) throw Error('Unexpected catalog path');
    const id=document.name.slice(prefix.length);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id) || seen.has(id)) throw Error('Invalid catalog document ID');
    seen.add(id);
    const fields=document.fields || {};
    if (typeof fields!=='object' || Array.isArray(fields)) throw Error('Invalid catalog fields');
    return {...Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,decode(value)])),id};
  });
}

function requestCatalog(projectId, {fetcher=fetch, timeout=1200} = {}) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  const done=readPublicCatalog(projectId,{fetcher,signal:controller.signal})
    .catch(()=>null) // Full SDK listener owns loading/error UI and fallback reads.
    .finally(()=>clearTimeout(timer));
  return {done, stop(){controller.abort();clearTimeout(timer);}};
}

let prepared=null;
export function primePublicCatalog(projectId, options={}) {
  if (prepared || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId || '')) return;
  prepared={projectId,fetcher:options.fetcher||fetch,task:requestCatalog(projectId,options)};
}

export function startPublicCatalog(projectId, onSnapshot, options={}) {
  let task;
  if (prepared && prepared.projectId===projectId && prepared.fetcher===(options.fetcher||fetch)) {
    task=prepared.task;prepared=null; // Consume once; never reuse an old snapshot on retry.
  } else task=requestCatalog(projectId,options);
  let superseded=false;
  const done=task.done.then(records=>{if(records && !superseded)onSnapshot(records);});
  return {done,stop(){superseded=true;task.stop();}};
}

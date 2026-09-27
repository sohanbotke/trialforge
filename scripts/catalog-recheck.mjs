// Read-only reminder report. Never crawls providers, approves records or writes
// verifiedAt. A successful HTTP response is NOT evidence of valid offer terms.
import { pathToFileURL } from 'node:url';
import { firebaseConfig } from '../firebase-config.js';
import { recheckQueue, REVIEW_WINDOW_DAYS } from '../catalog-policy.mjs';

export async function loadPublicCatalog(fetcher=fetch) {
  const endpoint=`https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/catalog`;
  const records=[], seen=new Set();let token='';
  for(let page=0;page<50;page++) {
    const url=new URL(endpoint);url.searchParams.set('pageSize','100');
    if(token)url.searchParams.set('pageToken',token);
    const response=await fetcher(url,{signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw Error(`Public catalog read failed (${response.status}); no verification performed.`);
    const body=await response.json();
    if(!body || typeof body!=='object' || (body.documents!==undefined&&!Array.isArray(body.documents)))throw Error('Malformed catalog response.');
    for(const document of body.documents||[]) {
      const id=document.name?.split('/').at(-1);
      if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id||''))throw Error('Invalid public catalog ID.');
      const fields=document.fields||{};
      const record={id};
      for(const key of ['name','url','status'])record[key]=fields[key]?.stringValue;
      for(const key of ['verifiedAt','expiresAt'])record[key]=fields[key]?.timestampValue??(fields[key]?.nullValue===null||fields[key]===undefined?null:'invalid');
      records.push(record);
    }
    token=body.nextPageToken;
    if(!token)return records;
    if(typeof token!=='string'||seen.has(token))throw Error('Invalid catalog pagination; refusing a partial report.');
    seen.add(token);
  }
  throw Error('Catalog exceeds report limit; refusing a partial report.');
}

export function recheckReport(records,now=Date.now()) {
  return {generatedAt:new Date(now).toISOString(),reviewWindowDays:REVIEW_WINDOW_DAYS,
    publicRecords:records.length,due:recheckQueue(records,now),
    note:'Read-only review reminder, not provider verification. Recheck official terms in the admin queue; failed or blocked fetches must not be treated as gone or verified.'};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const report=recheckReport(await loadPublicCatalog());
    console.log(JSON.stringify(report,null,2));
    if(report.due.length){console.error(`${report.due.length} published offers need human recheck.`);process.exitCode=2;}
  }catch(error){console.error(error.message);process.exitCode=1;}
}

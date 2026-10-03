import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import lighthouse from 'lighthouse';
import {launch} from 'chrome-launcher';
import {chromium} from 'playwright';
import puppeteer from 'puppeteer-core';
import {checkAssetBudgets} from './performance-budgets.mjs';

const root = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('release.json',root),'utf8'));
const bytes = {};
const assets = new Map();
for (const file of [...Object.keys(manifest.files),'release.json']) {
  const data = await readFile(new URL(file,root));
  const compressed = gzipSync(data);
  bytes[file] = {raw:data.length,gzip:compressed.length};
  assets.set(`/${file}`,{data,compressed});
}
const total=checkAssetBudgets(bytes);

// Serve the exact release assets with compression, as Firebase Hosting does.
// No fixtures, SDK blocking, auth override, or audit-specific app path.
const server = createServer((request,response)=>{
  const pathname = new URL(request.url,'http://localhost').pathname;
  const item=assets.get(pathname==='/'?'/index.html':pathname);
  if(!item){response.writeHead(404);response.end();return;}
  const type=pathname.endsWith('.json')?'application/json':pathname.endsWith('.svg')?'image/svg+xml':/\.(mjs|js)$/.test(pathname)?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html';
  const gzip=/\bgzip\b/.test(request.headers['accept-encoding']||'');
  response.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache',...(gzip?{'Content-Encoding':'gzip'}:{})});
  response.end(gzip?item.compressed:item.data);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let chrome;
let browser;
try {
  chrome=await launch({chromePath:chromium.executablePath(),chromeFlags:['--headless','--no-sandbox']});
  browser=await puppeteer.connect({browserURL:`http://127.0.0.1:${chrome.port}`});
  const page=(await browser.pages())[0] || await browser.newPage();
  await page.bringToFront();
  // Observe readiness during collection: Lighthouse detaches its frame during
  // cleanup, so it is too late to query the audited DOM after it returns.
  const ready=page.waitForFunction(()=>document.querySelector('#catalogStatus')?.textContent.startsWith('Live catalog updates')
    && document.querySelectorAll('#trialFeed article').length>0 && !document.querySelector('main').inert,{timeout:60000,polling:100}).then(()=>true,()=>false);
  const result=await lighthouse(`http://127.0.0.1:${server.address().port}/`,{
    port:chrome.port,onlyCategories:['performance','accessibility'],logLevel:'error',
    formFactor:'mobile',throttlingMethod:'simulate'
  },undefined,page);
  const report=result.lhr;
  assert(await ready,'The actual cloud-backed guest catalog must load during the audit');
  // Firestore's live Listen stream deliberately stays open. Lighthouse 13 waits
  // for critical requests to finish and warns even after the app has loaded.
  // Accept that warning ONLY when the trace proves every unfinished request is
  // this stream and the actual cloud-backed catalog above has rendered.
  const unfinished=new Map();
  for(const event of result.artifacts.DevtoolsLog || []) {
    if(event.method==='Network.requestWillBeSent') unfinished.set(event.params.requestId,event.params.request.url);
    if(['Network.loadingFinished','Network.loadingFailed'].includes(event.method)) unfinished.delete(event.params.requestId);
  }
  const streamOnly=unfinished.size>0 && [...unfinished.values()].every(value=>{
    const url=new URL(value);return url.origin==='https://firestore.googleapis.com' && url.pathname==='/google.firestore.v1.Firestore/Listen/channel';
  });
  const summary={commit:manifest.commit,lighthouse:report.lighthouseVersion,
    scores:Object.fromEntries(Object.entries(report.categories).map(([key,value])=>[key,value.score])),
    metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift'].map(key=>[key,report.audits[key].numericValue])),
    failures:Object.values(report.audits).filter(audit=>audit.score!==null&&audit.score<1).map(audit=>({id:audit.id,title:audit.title,value:audit.displayValue})),
    warnings:report.runWarnings,unfinishedFirestoreStreams:streamOnly?unfinished.size:0,bytes,totalGzip:total};
  // Keep only aggregate audit data: never archive auth/channel URLs or records.
  await mkdir(new URL('../.audit-results/',import.meta.url),{recursive:true});
  await writeFile(new URL('../.audit-results/mobile.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
  assert(!report.runtimeError, `Audit runtime error: ${report.runtimeError?.message}`);
  assert(report.categories.performance.score >= .90, 'Mobile performance must be at least 90');
  assert(report.categories.accessibility.score === 1, 'Automated accessibility must be 100');
  assert(report.audits['largest-contentful-paint'].numericValue <= 3000, 'Mobile LCP must be <= 3 seconds');
  assert(report.audits['cumulative-layout-shift'].numericValue <= .1, 'Mobile CLS must be <= 0.1');
  assert(report.audits['total-blocking-time'].numericValue <= 200, 'Mobile TBT must be <= 200 ms');
  assert(report.runWarnings.every(value=>streamOnly && /page loaded too slowly to finish within the time limit/i.test(value)), 'Unexpected/incomplete audit warning');
  assert.equal(report.audits['label-content-name-mismatch'].score,1,'Visible link labels must match accessible names');
} finally {
  await browser?.disconnect();
  await chrome?.kill();
  await new Promise(resolve=>server.close(resolve));
}

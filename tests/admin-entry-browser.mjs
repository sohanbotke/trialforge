import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.TRYWISE_BASE_URL||'http://127.0.0.1:4177';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixtures only.');
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/firebase-client.mjs',route=>route.fulfill({contentType:'text/javascript',body:`
    export const isFirebaseConfigured=()=>true;
    export async function createFirebaseClient(){
      window.adminChecks=[];
      return {catalog:{watchCatalog(ready){ready([]);},checkAdmin(){return new Promise(resolve=>window.adminChecks.push(resolve));}},
        onAuth(callback){window.testAuth=callback;callback(null);},
        load:async()=>null,subscribe(){return ()=>{};},signOut(){window.testAuth(null);}};
    }
  `}));
  await page.goto(base);
  await page.locator('[data-add-catalog="hellofresh"]').waitFor();
  assert.equal(await page.locator('#adminReviewLink').isVisible(),false);
  assert.equal(await page.locator('[data-review-offer]').count(),0);
  const authenticate=async uid=>{
    await page.evaluate(uid=>window.testAuth({uid,email:'fixture@example.test'}),uid);
    await page.waitForFunction(()=>window.adminChecks.length>0&&!document.querySelector('main').inert);
  };
  await authenticate('ordinary-user');
  assert.equal(await page.locator('#adminReviewLink').isVisible(),false,'Hidden while permission check is pending');
  await page.evaluate(()=>window.adminChecks.shift()(false));
  assert.equal(await page.locator('[data-review-offer]').count(),0);
  await authenticate('admin-user');
  await page.evaluate(()=>window.adminChecks.shift()(true));
  await page.locator('#adminReviewLink').waitFor({state:'visible'});
  assert.equal(await page.locator('#adminReviewLink').getAttribute('href'),'/admin.html?queue=seeds');
  assert.equal(await page.locator('[data-review-offer="hellofresh"]').getAttribute('href'),'/admin.html?offer=hellofresh');
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Admin entry overflow at ${width}`);
  }
  if(process.env.TRYWISE_SCREENSHOT_DIR) {
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/admin-entry-mobile.png`});
    await page.locator('[data-review-offer="hellofresh"]').evaluate(el=>el.closest('article').scrollIntoView({block:'start'}));
    await page.screenshot({path:`${process.env.TRYWISE_SCREENSHOT_DIR}/admin-card-review-mobile.png`});
  }
  await page.evaluate(()=>window.testAuth(null));
  await page.waitForFunction(()=>document.getElementById('adminReviewLink').hidden);
  assert.equal(await page.locator('[data-review-offer]').count(),0,'Sign-out clears every card action');
  await authenticate('delayed-admin');
  await page.evaluate(()=>{window.testAuth(null);window.adminChecks.shift()(true);});
  assert.equal(await page.locator('#adminReviewLink').isVisible(),false,'Late admin result cannot restore guest privileges');
  assert.equal(await page.locator('[data-review-offer]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Admin entry checks passed: guest/non-admin/pending hidden, approved admin links, four widths, sign-out and stale-check clearing.');
}finally{await browser.close();}

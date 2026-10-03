import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAssetBudgets} from '../scripts/performance-budgets.mjs';
const fixture=()=>({'index.html':{raw:110000,gzip:26000},'seed-catalog.mjs':{raw:19000,gzip:4200}});
test('release, entry, catalog and raw asset budgets fail closed on regression',()=>{
  assert.equal(checkAssetBudgets(fixture()),30200);
  assert.throws(()=>checkAssetBudgets({...fixture(),'extra.mjs':{raw:100000,gzip:80000}}),/Release gzip/);
  assert.throws(()=>checkAssetBudgets({...fixture(),'index.html':{raw:100000,gzip:36000}}),/Entry HTML/);
  assert.throws(()=>checkAssetBudgets({...fixture(),'seed-catalog.mjs':{raw:30000,gzip:11000}}),/Starter catalog/);
  assert.throws(()=>checkAssetBudgets({...fixture(),'extra.mjs':{raw:190000,gzip:1000}}),/180 KiB/);
  assert.throws(()=>checkAssetBudgets({...fixture(),'extra.mjs':{raw:NaN,gzip:1}}),/Invalid raw/);
  assert.throws(()=>checkAssetBudgets({...fixture(),'extra.mjs':{raw:1,gzip:NaN}}),/Invalid gzip/);
  assert.throws(()=>checkAssetBudgets({}),/Entry HTML/);
});

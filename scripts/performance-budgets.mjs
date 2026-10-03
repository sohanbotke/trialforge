import assert from 'node:assert/strict';

export function checkAssetBudgets(bytes) {
  for(const [name,size] of Object.entries(bytes)) {
    assert(Number.isSafeInteger(size.raw) && size.raw>=0,`Invalid raw size for ${name}`);
    assert(Number.isSafeInteger(size.gzip) && size.gzip>=0,`Invalid gzip size for ${name}`);
    assert(size.raw<=180*1024,`${name} exceeds 180 KiB raw`);
  }
  const total=Object.values(bytes).reduce((sum,value)=>sum+value.gzip,0);
  assert(total<=100*1024,`Release gzip budget exceeded: ${total} > 100 KiB`);
  assert(bytes['index.html']?.gzip<=35*1024,'Entry HTML exceeds 35 KiB gzip');
  assert(bytes['seed-catalog.mjs']?.gzip<=10*1024,'Starter catalog exceeds 10 KiB gzip; paginate before expansion');
  return total;
}

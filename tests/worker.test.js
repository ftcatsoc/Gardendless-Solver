import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorker} from '../src/compute-task.js';
test('Worker 完成、异常、取消、超时均释放资源，忽略迟到响应',async()=>{
 for(const mode of ['success','error','cancel','timeout']){
  let terminated=0, worker, busy=[];const controller=new AbortController();
  const result=runWorker({}, {signal:controller.signal,timeoutMs:10,onBusy:b=>busy.push(b),createWorker:()=>worker={terminate(){terminated++;},postMessage(){
   if(mode==='success')queueMicrotask(()=>worker.onmessage({data:{result:42}}));
   if(mode==='error')queueMicrotask(()=>worker.onerror());
   if(mode==='cancel')queueMicrotask(()=>controller.abort());
  }}});
  if(mode==='success')assert.equal(await result,42);else await assert.rejects(result);
  worker.onmessage({data:{result:999}});assert.equal(terminated,1);assert.deepEqual(busy,[true,false]);
 }
});

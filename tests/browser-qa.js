import fixtures from './browser-fixtures.json';
import {compute} from '../src/compute.js';
import {BrowserStorage} from '../src/storage.js';
import {Store} from '../src/store.js';
import {Model} from '../src/core/algorithms/pvz_solver.js';
import {RECIPES} from '../src/core/rules.js';
const output=document.querySelector('#result');
const log=s=>{output.textContent+='\n'+s;};
const assert=(value,message)=>{if(!value)throw Error(message);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const withoutTiming=result=>{const copy=structuredClone(result);delete copy.elapsedMs;return copy;};
const action=(s,type,extra={},options={})=>s.action({revision:s.state.revision,type,...extra},options);
const identity=s=>({gameId:s.state.game.id,round:s.state.game.history.length+1});
let clicks=0;
document.querySelector('#responsive').onclick=event=>{event.target.textContent='响应测试：'+ ++clicks;};
document.querySelector('#offline').onclick=async()=>{
 try{const result=await compute(fixtures[1].input);assert(same(withoutTiming(result),fixtures[1].expected),'结果不同');log('PASS 已加载 Worker 独立运算：'+result.next.join(' '));}
 catch(e){log('FAIL '+e.message);}
};
document.querySelector('#run').onclick=async event=>{
 event.target.disabled=true;output.textContent='正在运行…';
 const connections=[];const name='pvz-helper-qa-'+crypto.randomUUID();
 try{
  for(const f of fixtures){
   const wall=[],inside=[];let heartbeats=0;const ticker=setInterval(()=>heartbeats++,1);
   try{for(let i=0;i<11;i++){
    const started=performance.now(),result=await compute(f.input);
    assert(same(withoutTiming(result),f.expected),'浏览器与原实现建议不一致');
    if(i){wall.push(performance.now()-started);inside.push(result.elapsedMs);}
   }}finally{clearInterval(ticker);}
   log(`PASS ${f.input.algorithmId}：原 Node 中位数 ${f.nodeMedianMs.toFixed(2)} ms；浏览器计算 ${inside.sort((a,b)=>a-b)[5].toFixed(2)} ms；含线程启动 ${wall.sort((a,b)=>a-b)[5].toFixed(2)} ms；主线程心跳 ${heartbeats}`);
  }
  const a=new BrowserStorage(name),b=new BrowserStorage(name);connections.push(a,b);
  const first=new Store(a,compute),second=new Store(b,compute);await first.init();await second.init();
  const rules={note:'QA',recipes:Object.fromEntries(RECIPES.map(q=>[q,true]))};
  const writes=await Promise.allSettled([action(first,'rules',{rules}),action(second,'rules',{rules})]);
  assert(writes.filter(r=>r.status==='fulfilled').length===1,'并发覆盖');
  assert(writes.find(r=>r.status==='rejected').reason.status===409,'缺少冲突提示');
  await first.init();log('PASS 真实 IndexedDB 双连接修订冲突');
  await action(first,'start',{algorithmId:'joint'});
  const m=new Model(),secret=m.encode(['AB','AA','DD','CC','FF','EE','HH','GG','JJ','II']);
  let pending={query:Array(10).fill('AB'),response:'GBBBBBBBBB'};
  await action(first,'draft',{...identity(first),pending});
  await action(first,'submit',{...identity(first),pending});
  assert(first.state.game.advice.locked[0]==='AB','蓝色优先或重复配方错误');
  const history=JSON.stringify(first.state.game.history);
  const reject=async(fn,pattern)=>{try{await fn();throw Error('未拒绝');}catch(e){assert(pattern.test(e.message),'意外错误：'+e.message);}};
  pending={query:[...first.state.game.pending.query],response:'XXXXXXXXXX'};
  await action(first,'draft',{...identity(first),pending});
  await reject(()=>action(first,'submit',{...identity(first),pending}),/锁|矛盾/);
  assert(JSON.stringify(first.state.game.history)===history,'矛盾进入历史');
  await second.init();assert(same(second.state.game.pending,pending),'草稿恢复失败');
  await reject(()=>action(first,'rules',{rules}),/进行中/);
  await action(first,'undo',{gameId:first.state.game.id});
  assert(first.state.game.history.length===0,'撤回错误');
  const archive=first.export('session');
  await action(first,'end',identity(first));
  await action(first,'import',{file:archive});
  assert(same(first.export('session').game.history,archive.game.history),'旧格式往返失败');
  log('PASS 重复配方、蓝色优先、绿锁、矛盾保留、恢复、规则锁、撤回、schemaVersion 1 往返');
  const before=JSON.stringify(first.state);
  const abort=new AbortController();abort.abort();
  await reject(()=>action(first,'submit',{...identity(first),pending:first.state.game.pending},{signal:abort.signal}),/abort|取消/i);
  assert(JSON.stringify(first.state)===before,'取消污染历史');
  const controller=new AbortController();
  await reject(()=>compute(fixtures[1].input,{signal:controller.signal,onBusy:busy=>{if(busy)controller.abort();}}),/取消/);
  await reject(()=>compute(fixtures[1].input,{timeoutMs:0}),/60 秒/);
  log('PASS 真实 Worker 取消与超时，不写入历史');
  const unavailable=new BrowserStorage(name+'-denied',{open(){throw new DOMException('denied','SecurityError');}});
  await reject(()=>unavailable.read(),/存储|保存|浏览器/);
  const commit=a.commit.bind(a);a.commit=async()=>{throw Object.assign(Error('模拟存储写入失败'),{storageFailure:true});};
  await reject(()=>action(first,'draft',{...identity(first),pending:first.state.game.pending}),/存储写入失败/);
  assert(JSON.stringify(first.state)===before,'保存失败却更新状态');a.commit=commit;
  log('PASS 存储不可用与写入失败保留状态');
  let rounds=0;
  while(first.state.game.status==='active'){
   const query=first.state.game.pending.query,response=m.feedback(secret,m.encode(query));
   await action(first,'submit',{...identity(first),pending:{query,response}});
   assert(++rounds<30,'未收敛');
  }
  assert(first.state.game.status==='completed','未完成');
  await second.init();assert(second.state.game.status==='completed','全绿保存失败');
  log('PASS 真实 Worker + IndexedDB 完整对局：'+rounds+' 轮');
  log('全部通过');
 }catch(e){log('FAIL '+e.stack);}
 finally{connections.forEach(db=>db.close());indexedDB.deleteDatabase(name);event.target.disabled=false;}
};

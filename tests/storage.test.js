import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';
import {BrowserStorage} from '../src/storage.js';
import {Store} from '../src/store.js';
import {analyze} from '../src/core/analyze.js';
import {RECIPES} from '../src/core/rules.js';
const rules={note:'test',recipes:Object.fromEntries(RECIPES.map(q=>[q,true]))};
const calc=async input=>analyze(input);
test('原服务版实际导出的 schemaVersion 1 JSON 可直接恢复并继续', async t=>{
 const file=JSON.parse(await readFile(new URL('./fixtures/legacy-session.json',import.meta.url),'utf8'));
 const storage=new BrowserStorage('legacy-import',new IDBFactory()),store=new Store(storage,calc);
 t.after(()=>storage.close());await store.init();
 await store.action({type:'import',revision:0,file});
 assert.deepEqual(store.state.game.pending,file.game.pending);
 assert.equal(store.state.game.seed,42);
 await store.action({type:'submit',revision:store.state.revision,gameId:store.state.game.id,round:1,pending:store.state.game.pending});
 assert.equal(store.state.game.advice.locked[0],'AB');
 assert.equal(store.state.game.history[0].response,'GBBBBBBBBB');
});
async function fixture(t){
 const factory=new IDBFactory(),storage=new BrowserStorage('test',factory),store=new Store(storage,calc);
 t.after(()=>storage.close()); await store.init();
 const act=(type,p={})=>store.action({type,revision:store.state.revision,...p});
 await act('rules',{rules}); await act('start',{algorithmId:'probe'});
 const identity=()=>({gameId:store.state.game.id,round:store.state.game.history.length+1});
 return {factory,storage,store,act,identity};
}
test('IndexedDB 原子修订检查阻止两个标签页覆盖',async t=>{
 const factory=new IDBFactory(),a=new BrowserStorage('race',factory),b=new BrowserStorage('race',factory);
 t.after(()=>{a.close();b.close();});
 const results=await Promise.allSettled([a.commit({revision:1,value:'a'},0),b.commit({revision:1,value:'b'},0)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.find(x=>x.status==='rejected').reason.status,409);
 assert.equal((await a.read()).revision,1);
});
test('草稿、矛盾、锁定、重复提交、撤回及存档往返',async t=>{
 const {store,act,identity,storage}=await fixture(t);
 const query=store.state.game.pending.query;
 await act('draft',{...identity(),pending:{query,response:'PPPPPPPPPP'}});
 await assert.rejects(act('submit',{...identity()}),/矛盾/);
 assert.equal(store.state.game.history.length,0);assert.equal(store.state.game.pending.response,'PPPPPPPPPP');
 await assert.rejects(act('rules',{rules}),/进行中/);
 const request={type:'submit',revision:store.state.revision,...identity(),pending:{query,response:'GPPPPPPPPP'}};
 await store.action(request); await assert.rejects(store.action(request),/已更新/);
 assert.equal(store.state.game.advice.locked[0],'AA');
 const draft=structuredClone(store.state.game.pending);draft.query[0]='BB';
 await assert.rejects(act('draft',{...identity(),pending:draft}),/已锁格/);
 const saved=store.export('session');
 const restored=new Store(storage,calc);await restored.init();assert.deepEqual(restored.state.game.pending,store.state.game.pending);
 await act('end',identity());await act('import',{file:saved});
 assert.deepEqual(store.state.game.history,saved.game.history);
 await act('undo',{gameId:store.state.game.id});assert.equal(store.state.game.history.length,0);
 assert.equal(store.state.game.pending.response,'GPPPPPPPPP');
});
test('全绿与旧规则快照、版本拒绝、错误导入不损坏存档',async t=>{
 const {store,act,identity,storage}=await fixture(t);
 await act('submit',{...identity(),pending:{query:['BB','BC','CC','DD','EE','FF','GG','HH','II','JJ'],response:'GGGGGGGGGG'}});
 assert.equal(store.state.game.status,'completed');
 await act('rules',{rules:{...rules,recipes:{...rules.recipes,AB:false}}});
 assert.equal(store.state.game.rulesSnapshot.recipes.AB,true);
 const saved=store.export('session'),broken=structuredClone(saved);broken.game.algorithmVersion='999';
 const before=await storage.read();await assert.rejects(act('import',{file:broken}),/版本/);assert.deepEqual(await storage.read(),before);
 await act('undo',{gameId:store.state.game.id});assert.equal(store.state.game.status,'active');
 assert.equal(store.state.game.rulesSnapshot.recipes.AB,true);
});
test('存储拒绝与提交时写入失败不会伪装成功或覆盖历史',async t=>{
 const unavailable=new BrowserStorage('blocked',{open(){throw new DOMException('denied','SecurityError');}});
 await assert.rejects(unavailable.read(),e=>e.storageFailure);
 const {store,storage,act,identity}=await fixture(t);
 const pending={query:store.state.game.pending.query,response:'XPPPPPPPPP'};
 await act('draft',{...identity(),pending});const before=structuredClone(store.state), disk=await storage.read();
 const commit=storage.commit.bind(storage);storage.commit=async()=>{throw new DOMException('full','QuotaExceededError');};
 await assert.rejects(act('submit',{...identity()}));assert.deepEqual(store.state,before);
 assert.deepEqual(await storage.read(),disk);
 storage.commit=commit;await act('submit',{...identity()});assert.equal(store.state.game.history.length,1);
});
test('取消计算不提交新轮次',async t=>{
 const {store,act,identity,storage}=await fixture(t);
 await act('draft',{...identity(),pending:{query:store.state.game.pending.query,response:'XPPPPPPPPP'}});
 const before=await storage.read(),controller=new AbortController();
 store.calculate=async input=>{controller.abort();return analyze(input);};
 await assert.rejects(store.action({type:'submit',revision:store.state.revision,...identity()},{signal:controller.signal}));
 assert.deepEqual(await storage.read(),before);assert.equal(store.state.game.history.length,0);
});

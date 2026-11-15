import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {analyze} from '../src/core/analyze.js';
import {RECIPES} from '../src/core/rules.js';
import {Model, RNG, randomSecret} from '../src/core/algorithms/pvz_solver.js';
const require = createRequire(import.meta.url), old = require('./reference/engine.cjs');
const rules = legal => ({note:'test',recipes:Object.fromEntries(RECIPES.map(q=>[q,legal.includes(q)]))});
test('原实现封存哈希保持不变',async()=>{
  for (const [name, hash] of [['pvz_solver','99790aab58e17ca3cda942f50dd502360672a8061a52c194a9cdbb7b75ace6f1'],['systematic_probe','a8a6726189ce6cd3ce5a6f1a6f23d4b739b32361d180554c77bdd640992cc3e1']])
    assert.equal(createHash('sha256').update(await readFile(new URL(`reference/algorithms/${name}.cjs`,import.meta.url))).digest('hex'),hash);
});
test('96 局逐轮对照旧实现：建议、候选、锁格、计数与结果全部相同',()=>{
  const families=[RECIPES,RECIPES.filter(q=>!['AB','AD','AF','AH','AJ'].includes(q)),RECIPES.filter(q=>q[0]!=='A'),RECIPES.filter(q=>q[0]===q[1])];
  let count=0;
  for(const [family,legal] of families.entries()) for(const algorithmId of ['probe','joint']){
    const model=new Model(10,10,legal), rng=new RNG(8137+family);
    for(let g=0;g<12;g++){
      const secret=randomSecret(model,rng), input={legalRecipes:legal,history:[],algorithmId,algorithmVersion:'1.0.0',seed:g+9527};
      while(true){
        const result=analyze(input), reference=old.analyze({...input,rules:rules(legal)});
        delete reference.elapsedMs; assert.deepEqual(result,reference);
        if(result.done)break;
        input.history.push({query:result.next,response:model.feedback(secret,model.encode(result.next))});
        assert.ok(input.history.length<40);
      }
      count++;
    }
  }
  assert.equal(count,96);
});
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
test('冻结输入、重复调用和交错对局不污染状态',()=>{
  const input=freeze({legalRecipes:RECIPES,history:[{query:['AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ'],response:'XPPPPPPPPP'}],algorithmId:'joint',algorithmVersion:'1.0.0',seed:42});
  const before=JSON.stringify(input), result=analyze(input);
  analyze({...input,algorithmId:'probe',seed:99});
  assert.deepEqual(analyze(input),result);assert.equal(JSON.stringify(input),before);
  assert.ok(!Object.hasOwn(result,'elapsedMs'));
});
test('蓝色优先、重复配方、非法配方与矛盾',()=>{
 const m=new Model(),s=m.encode(['AB','AA','DD','CC','FF','EE','HH','GG','JJ','II']);
 assert.equal(m.feedback(s,m.encode(Array(10).fill('AB'))),'GBBBBBBBBB');
 const input={legalRecipes:RECIPES,history:[{query:['AA','AB','AC','AD','AE','AF','AG','AH','AI','AJ'],response:'PPPPPPPPPP'}],algorithmId:'probe',seed:1};
 assert.throws(()=>analyze(input),/矛盾/);
 assert.throws(()=>analyze({...input,legalRecipes:RECIPES.filter(q=>q!=='AA')}),/不可合成/);
});

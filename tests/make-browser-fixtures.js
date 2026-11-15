import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {RECIPES} from '../src/core/rules.js';
const old=createRequire(import.meta.url)('./reference/engine.cjs');
const fixtures=[];
for(const algorithmId of ['probe','joint']) {
 const rules={note:'合成验收样例（非游戏预设）',recipes:Object.fromEntries(RECIPES.map(q=>[q,true]))};
 const history=[{query:RECIPES.slice(0,10),response:'XPPPPPPPPP'}];
 const input={legalRecipes:RECIPES,history,algorithmId,algorithmVersion:'1.0.0',seed:42};
 const timings=[];let expected;
 for(let i=0;i<11;i++){const t=performance.now();expected=old.analyze({...input,rules});if(i)timings.push(performance.now()-t);}
 delete expected.elapsedMs;
 fixtures.push({input,expected,nodeMedianMs:timings.sort((a,b)=>a-b)[5]});
}
await writeFile(new URL('browser-fixtures.json',import.meta.url),JSON.stringify(fixtures));
console.log(fixtures.map(f=>({algorithm:f.input.algorithmId,nodeMedianMs:f.nodeMedianMs})));

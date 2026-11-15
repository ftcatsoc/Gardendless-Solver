import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES, canonical, validateDraft} from '../src/core/rules.js';
import {recipeLabel, recipeInput, recipeMessage} from '../src/ui/recipe-labels.js';

test('55 种旧配方均可用数字显示、编辑并无损恢复，10 不与 1 混淆',()=>{
  assert.equal(new Set(RECIPES.map(recipeLabel)).size,55);
  for(const recipe of RECIPES){
    const label=recipeLabel(recipe);
    assert.equal(recipeInput(label),recipe);
    assert.equal(recipeInput(label.split('+').reverse().join('+')),recipe);
  }
  assert.equal(recipeInput('10+2'),'BJ');
  assert.equal(recipeInput(' 10 ＋ 10 '),'JJ');
  assert.equal(recipeLabel('AJ'),'1+10');
  assert.equal(recipeLabel('JJ'),'10+10');
});
test('不完整数字输入保存在草稿中；非法范围和无分隔输入不会误当合法配方',()=>{
  for(const value of ['10+','110','0+1','11+1','1+10+2']){
    const query=Array(10).fill(recipeInput(value));
    assert.equal(validateDraft({query,response:'----------'}).query[0],value);
    assert.equal(recipeLabel(value),value);
    assert.throws(()=>canonical(recipeInput(value)));
  }
  assert.equal(recipeMessage('配方 AJ 在本局合成表中不可合成。'),'配方 1+10 在本局合成表中不可合成。');
});

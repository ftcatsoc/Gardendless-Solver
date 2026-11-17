import test from 'node:test';
import assert from 'node:assert/strict';
import {t, setLanguage, readLanguage, saveLanguage} from '../src/ui/i18n.js';
import {recipeMessage} from '../src/ui/recipe-labels.js';

test('translations preserve parameters, user notes, recipe IDs and language round trips', () => {
  setLanguage('en');
  assert.equal(t('第 12 轮'), 'Round 12');
  assert.equal(t('12 个合法配方已准备好 · 我的规则'), '12 valid recipes ready · 我的规则');
  assert.equal(t(recipeMessage('配方 AJ 在本局合成表中不可合成。')), 'Recipe 1+10 is invalid in this game’s recipe table.');
  assert.equal(t('第 2 轮反馈与本局规则或前面的反馈矛盾。请核对蓝色优先、重复配方及已锁格。'), 'Round 2 contradicts the rules or earlier feedback. Check blue priority, repeated recipes and locked slots.');
  assert.equal(t('槽位 01 · ✓'), 'Slot 01 · ✓');
  assert.equal(t('未知的用户备注'), '未知的用户备注');
  setLanguage('zh-CN');
  assert.equal(t('第 12 轮'), '第 12 轮');
  setLanguage('en');
  assert.equal(t('第 12 轮'), 'Round 12');
});
test('language preference tolerates blocked storage without touching game data', () => {
  const data = new Map([['game', 'unchanged']]);
  const storage = {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};
  assert.equal(readLanguage(storage, 'language'), 'zh-CN');
  assert.equal(saveLanguage(storage, 'language', 'en'), true);
  assert.equal(readLanguage(storage, 'language'), 'en');
  assert.equal(data.get('game'), 'unchanged');
  assert.equal(readLanguage(undefined, 'language'), 'zh-CN');
  assert.equal(saveLanguage(undefined, 'language', 'en'), false);
});

test('DOM translation restores source text and preserves literal replacement characters', async () => {
  const {translatePage} = await import('../src/ui/i18n.js');
  const node = {nodeValue: '55 个合法配方已准备好 · $& 我的备注', parentElement: {closest: () => false}};
  const root = {documentElement: {}, querySelectorAll: () => [], createTreeWalker: () => {
    let visited = false;
    return {currentNode: node, nextNode() { if (visited) return false; visited = true; return true; }};
  }};
  setLanguage('en'); translatePage(root);
  assert.equal(node.nodeValue, '55 valid recipes ready · $& 我的备注');
  translatePage(root);
  assert.equal(node.nodeValue, '55 valid recipes ready · $& 我的备注');
  setLanguage('zh-CN'); translatePage(root);
  assert.equal(node.nodeValue, '55 个合法配方已准备好 · $& 我的备注');
  node.nodeValue = '第 4 轮';
  setLanguage('en'); translatePage(root);
  assert.equal(node.nodeValue, 'Round 4');
  assert.equal(root.documentElement.lang, 'en');
});

import {t, setLanguage, readLanguage, saveLanguage, translatePage} from './i18n.js';
import './app.css';
import {Store} from '../store.js';
import {BrowserStorage} from '../storage.js';
import {compute} from '../compute.js';
import {materialLabel, recipeLabel, recipeInput, recipeMessage} from './recipe-labels.js';
const storage = new BrowserStorage('pvz-helper:' + new URL(import.meta.env.BASE_URL, location.origin).pathname);
const store = new Store(storage, compute);
let loaded = false, controller, conflicted = false;
const computationOptions = () => ({signal: controller?.signal,
  onBusy: value => { document.getElementById('compute-status').hidden = !value; }});
'use strict';
const $ = id => document.getElementById(id);
const letters = 'ABCDEFGHIJ'.split('');
const recipes = letters.flatMap((a, i) => letters.slice(i).map(b => a + b));
const feedback = {G: ['✓ 全对', '完全正确'], B: ['↗ 错位', '栏位错误'], P: ['◐ 部分', '部分正确'], X: ['× 全错', '完全错误']};
let state, localRules, pending, selectedAlgorithm = 'joint', paint = true, tab = 'rules', busy = false;
let rulesDirty = false, draftDirty = false, rulesEpoch = 0, draftEpoch = 0, timer, saving;

const isActive = () => state?.game?.status === 'active';
const viewingRules = () => isActive() ? state.game.rulesSnapshot : localRules;
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function notify(text, success = false) {
  $('message').textContent = recipeMessage(text); translatePage(); $('message').className = `message${success ? ' success' : ''}`;
  $('message').hidden = !text;
}
function saveStatus(text) { $('save-status').textContent = text; translatePage(); }
function showFailure(error) {
  if (error.status === 409) conflicted = true;
  const message = error.name === 'AbortError' ? '计算已取消，输入仍保留。' : error.message;
  notify(message || '操作未完成，输入仍保留。');
  if (error.storageFailure || error.status === 409 || !loaded) $('storage-recovery').hidden = false;
  saveStatus('操作未完成 · 输入仍保留');
}
async function request(type, payload = {}) {
  if (!loaded) throw Error('请先重试读取浏览器存档。当前输入可导出备份。');
  state = await store.action({revision: state.revision, type, ...payload}, computationOptions());
  return state;
}
function gameIdentity() { return {gameId: state.game.id, round: state.game.history.length + 1}; }
function scheduleSave() {
  saveStatus('有输入尚未保存');
  clearTimeout(timer);
  timer = setTimeout(() => { if (!busy) flush().catch(showFailure); }, 400);
}
async function flush() {
  clearTimeout(timer);
  if (saving) return saving;
  saving = (async () => {
    while (rulesDirty || draftDirty) {
      saveStatus('正在保存…');
      if (rulesDirty) {
        const epoch = rulesEpoch;
        await request('rules', {rules: structuredClone(localRules)});
        if (epoch === rulesEpoch) rulesDirty = false;
      }
      if (draftDirty) {
        const epoch = draftEpoch;
        await request('draft', {...gameIdentity(), pending: structuredClone(pending)});
        if (epoch === draftEpoch) draftDirty = false;
      }
    }
    saveStatus('已保存到此浏览器');
  })();
  try { await saving; } finally { saving = null; }
}
async function perform(type, payload = {}) {
  if (busy) return;
  busy = true; controller = new AbortController(); notify(''); renderDisabled();
  const originalLabel = '提交反馈，计算下一轮 →';
  if (type === 'submit') { $('submit').textContent = '正在推理…'; translatePage(); }
  try {
    await flush();
    const actual = typeof payload === 'function' ? payload() : payload;
    await request(type, actual);
    localRules = structuredClone(state.rules);
    pending = state.game ? structuredClone(state.game.pending) : null;
    if (['start', 'submit', 'undo'].includes(type)) tab = 'game';
    $('edit-query').checked = false;
    saveStatus('已保存到此浏览器');
    if (type === 'import') notify('导入完成，规则与历史已通过校验。', true);
    if (type === 'undo') notify('已撤回上一轮。原来的填写与反馈已放回输入区，可修改后重新提交。', true);
  } catch (error) { showFailure(error); }
  finally { busy = false; $('submit').textContent = originalLabel; render(); }
}
function setTab(value) { tab = value; renderPages(); }
function renderPages() { renderPagesContent(); translatePage(); }
function renderPagesContent() {
  $('rules-page').hidden = tab !== 'rules'; $('game-page').hidden = tab !== 'game';
  $('nav-rules').classList.toggle('active', tab === 'rules');
  $('nav-game').classList.toggle('active', tab === 'game');
  $('page-title').textContent = tab === 'rules' ? '合成表' : '对局助手';
}
function renderRules() { renderRulesContent(); translatePage(); }
function renderRulesContent() {
  const rules = viewingRules(), values = Object.values(rules.recipes);
  const known = values.filter(v => v !== null).length, legal = values.filter(v => v === true).length;
  $('rules-count').textContent = `${known} / 55 已确认`;
  $('rules-breakdown').textContent = `${legal} 可合成 · ${known - legal} 不可合成 · ${55 - known} 未确认`;
  $('rules-locked').hidden = !isActive();
  $('rules-note').value = rules.note;
  $('matrix').replaceChildren();
  const head = el('tr'); head.append(el('th'));
  for (const c of letters) head.append(el('th', '', materialLabel(c)));
  $('matrix').append(head);
  for (const a of letters) {
    const row = el('tr'); row.append(el('th', '', materialLabel(a)));
    for (const b of letters) {
      const q = [a, b].sort().join(''), value = rules.recipes[q];
      const status = value === true ? '可合成' : value === false ? '不可合成' : '未确认';
      const td = el('td'), button = el('button',
        `${value === true ? 'legal' : value === false ? 'illegal' : 'unknown'}${a === b ? ' diagonal' : ''}`);
      button.setAttribute('aria-label', `${materialLabel(a)} + ${materialLabel(b)}：${t(status)}`);
      button.title = `${recipeLabel(q)} · ${t(status)}`;
      button.append(el('span', '', recipeLabel(q)), el('small', '', value === true ? '✓' : value === false ? '×' : '·'));
      button.disabled = !loaded || isActive() || busy;
      button.onclick = () => {
        localRules.recipes[q] = paint; rulesDirty = true; rulesEpoch++; renderRules(); renderSetup(); scheduleSave();
      };
      td.append(button); row.append(td);
    }
    $('matrix').append(row);
  }
}
function renderSetup() { renderSetupContent(); translatePage(); }
function renderSetupContent() {
  $('setup').hidden = isActive();
  $('algorithm-options').replaceChildren();
  for (const a of state.algorithms) {
    const label = el('label', 'algorithm-card'), input = document.createElement('input');
    input.type = 'radio'; input.name = 'algorithm'; input.value = a.id; input.checked = a.id === selectedAlgorithm;
    input.onchange = () => { selectedAlgorithm = a.id; };
    label.append(input, el('strong', '', t(a.name)), el('p', '', t(a.description)));
    $('algorithm-options').append(label);
  }
  const known = recipes.every(q => localRules.recipes[q] !== null);
  const legal = recipes.filter(q => localRules.recipes[q] === true).length;
  $('start-hint').textContent = !known ? '请先在合成表中确认全部 55 个组合。' :
    legal < 10 ? '至少需要十个合法配方。' : `${legal} 个合法配方已准备好 · ${localRules.note || t('未填写版本备注')}`;
  $('start').disabled = busy || !loaded || !known || legal < 10;
}
function responseChars() { return (pending?.response || '').toUpperCase().replace(/\s/g, '').split(''); }
function updateFeedbackButtons() {
  const chars = responseChars();
  for (const button of document.querySelectorAll('.feedback-button'))
    button.classList.toggle('selected', chars[Number(button.dataset.slot)] === button.dataset.feedback);
}
function renderGame() { renderGameContent(); translatePage(); }
function renderGameContent() {
  const game = state.game;
  $('board').hidden = !game;
  if (!game) return;
  const active = isActive(), name = state.algorithms.find(a => a.id === game.algorithmId)?.name || game.algorithmId;
  $('game-algorithm').textContent = `${t(name)} · ${game.algorithmVersion}`;
  $('round-title').textContent = active ? `第 ${game.history.length + 1} 轮` :
    game.status === 'completed' ? `${game.history.length} 轮，全部找到` : '本局已结束';
  $('game-meta').textContent = `${Object.keys(game.advice.locked).length} / 10 格已锁定 · ${game.rulesSnapshot.note || t('本局规则快照')}`;
  $('completed-banner').hidden = game.status !== 'completed';
  $('completed-banner').textContent = '✓ 十个位置已全部正确。可以导出本局记录，或调整规则后开始下一局。';
  $('slot-grid').replaceChildren();
  const chars = responseChars();
  for (let i = 0; i < 10; i++) {
    const locked = game.advice.locked[i] !== undefined;
    const card = el('div', `slot${locked ? ' locked' : ''}`);
    card.append(el('div', 'slot-number', `槽位 ${String(i + 1).padStart(2, '0')}${locked ? ' · ✓' : ''}`));
    const input = document.createElement('input');
    input.value = recipeLabel(pending.query[i] || ''); input.maxLength = 20; input.spellcheck = false;
    input.placeholder = '1+10';
    input.setAttribute('aria-label', `第 ${i + 1} 格实际配方`);
    input.readOnly = !active || locked || !$('edit-query').checked || busy;
    input.oninput = () => { pending.query[i] = recipeInput(input.value); draftDirty = true; draftEpoch++; scheduleSave(); };
    card.append(input);
    for (const [code, [short, full]] of Object.entries(feedback)) {
      const button = el('button', `feedback-button ${code}${chars[i] === code ? ' selected' : ''}`, short);
      button.dataset.slot = i; button.dataset.feedback = code;
      button.setAttribute('aria-label', `第 ${i + 1} 格：${t(full)}`);
      button.disabled = !active || locked || busy;
      button.onclick = () => {
        const next = responseChars();
        pending.response = Array.from({length: 10}, (_, j) => j === i ? code :
          Object.hasOwn(feedback, next[j]) ? next[j] : '-').join('');
        draftDirty = true; draftEpoch++; $('quick-feedback').value = pending.response;
        updateFeedbackButtons(); scheduleSave();
      };
      card.append(button);
    }
    $('slot-grid').append(card);
  }
  $('quick-feedback').value = pending.response;
  $('reasoning-summary').textContent = `${game.advice.present.length} 株已知存在 · ${game.advice.absent.length} 株已排除`;
  const reasoning = $('reasoning-content'); reasoning.replaceChildren();
  reasoning.append(el('p', '', `候选数（按槽位）：${game.advice.candidates.map(c => c.length).join(' / ')}`));
  reasoning.append(el('p', '', `已知存在：${game.advice.present.map(recipeLabel).join('、') || t('暂无')}`));
  reasoning.append(el('p', '', `已排除：${game.advice.absent.map(recipeLabel).join('、') || t('暂无')}`));
  $('history').replaceChildren();
  if (!game.history.length) $('history').append(el('div', 'empty-history', '第一轮反馈提交后，记录会显示在这里。'));
  for (const [index, turn] of [...game.history.entries()].reverse()) {
    const row = el('div', 'history-row'); row.append(el('span', '', `第 ${index + 1} 轮`));
    turn.query.forEach((q, i) => {
      const item = el('div', 'history-item', recipeLabel(q)), code = turn.response[i];
      item.append(el('span', `feedback-pill ${code}`, feedback[code][1])); row.append(item);
    });
    $('history').append(row);
  }
}
function renderDisabled() {
  $('retry-save').disabled = busy;
  if (!state) return;
  $('refresh').disabled = busy;
  for (const id of ['rules-note', 'all-legal', 'all-unknown', 'import-button'])
    $(id).disabled = busy || !loaded || isActive();
  for (const button of document.querySelectorAll('#matrix button')) button.disabled = busy || !loaded || isActive();
  for (const button of document.querySelectorAll('input[name=algorithm]')) button.disabled = busy;
  $('submit').disabled = busy || !loaded || !isActive();
  $('end').disabled = busy || !isActive();
  $('undo').disabled = busy || !state.game?.history.length;
  $('quick-feedback').disabled = busy || !isActive();
  $('edit-query').disabled = busy || !isActive();
  $('start').disabled = busy || !loaded || isActive() || recipes.some(q => localRules.recipes[q] === null) ||
    recipes.filter(q => localRules.recipes[q] === true).length < 10;
  for (const input of document.querySelectorAll('#slot-grid input'))
    if (busy) input.readOnly = true;
  for (const button of document.querySelectorAll('.feedback-button'))
    button.disabled = busy || !isActive() || state.game?.advice.locked[button.dataset.slot] !== undefined;
}
function render() { renderPages(); renderRules(); renderSetup(); renderGame(); renderDisabled(); }
async function load() {
  await store.init(computationOptions());
  state = store.snapshot(); localRules = structuredClone(state.rules);
  pending = state.game ? structuredClone(state.game.pending) : null;
  loaded = true; conflicted = false; rulesDirty = draftDirty = false;
  tab = state.game || recipes.every(q => localRules.recipes[q] !== null) ? 'game' : 'rules';
  render(); saveStatus('已读取 · 数据保存在此浏览器');
}
async function recover() {
  if (busy) return;
  busy = true; controller = new AbortController(); renderDisabled(); clearTimeout(timer);
  try {
    if (saving) await saving.catch(() => {});
    if (conflicted) throw Object.assign(Error('另一个标签页已有更新。请先导出当前输入，再点击“重新读取存档”核对；不会自动覆盖。'), {status: 409});
    if (!loaded) await load(); else await flush();
    $('storage-recovery').hidden = true;
    notify('当前输入已保存；未完成的操作请重新提交。', true);
  } catch (error) { showFailure(error); }
  finally { busy = false; if (state) render(); else renderDisabled(); }
}
$('retry-save').onclick = recover;
$('cancel-compute').onclick = () => controller?.abort();
function download(kind) {
  const file = store.export(kind);
  if (kind === 'rules' && !isActive() && localRules) file.rules = structuredClone(localRules);
  if (kind === 'session') {
    if (localRules) file.rules = structuredClone(localRules);
    if (file.game && pending) file.game.pending = structuredClone(pending);
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'pvz-' + kind + '-' + new Date().toISOString().slice(0,10) + '.json';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出当前输入；这不会覆盖浏览器中的存档。', true);
}
$('backup-input').onclick = () => download('session');
$('nav-game').onclick = () => setTab('game');
$('nav-rules').onclick = () => setTab('rules');
$('to-game').onclick = () => setTab('game');
for (const button of document.querySelectorAll('[data-paint]')) button.onclick = () => {
  paint = JSON.parse(button.dataset.paint);
  for (const b of document.querySelectorAll('[data-paint]')) b.classList.toggle('selected', b === button);
};
$('rules-note').oninput = () => {
  localRules.note = $('rules-note').value; rulesDirty = true; rulesEpoch++; renderSetup(); scheduleSave();
};
function bulk(value) {
  if (value === null && !confirm(t('将全部组合恢复为未确认？已导出的备份不受影响。'))) return;
  localRules.recipes = Object.fromEntries(recipes.map(q => [q, value]));
  rulesDirty = true; rulesEpoch++; renderRules(); renderSetup(); renderDisabled(); scheduleSave();
}
$('all-legal').onclick = () => bulk(true);
$('all-unknown').onclick = () => bulk(null);
$('start').onclick = () => {
  if (state.game?.history.length && !confirm(t('开始新局会替换当前记录。需要保留时请先导出对局。继续？'))) return;
  perform('start', {algorithmId: selectedAlgorithm});
};
$('submit').onclick = () => perform('submit', () => ({...gameIdentity(), pending: structuredClone(pending)}));
$('undo').onclick = () => perform('undo', () => ({gameId: state.game.id}));
$('end').onclick = () => {
  if (confirm(t('结束本局并解锁合成表？本局记录仍会保留，开始新局前可以导出。')))
    perform('end', () => gameIdentity());
};
$('edit-query').onchange = renderGame;
$('quick-feedback').oninput = () => {
  pending.response = $('quick-feedback').value.toUpperCase();
  draftDirty = true; draftEpoch++; updateFeedbackButtons(); scheduleSave();
};
$('copy-query').onclick = async () => {
  try { await navigator.clipboard.writeText(pending.query.map(recipeLabel).join(' ')); notify('本轮配方已复制。', true); }
  catch { notify(`本轮配方：${pending.query.map(recipeLabel).join(' ')}`, true); }
};
for (const kind of ['rules', 'session']) $('export-' + kind).onclick = () => download(kind);
$('import-button').onclick = () => $('import-file').click();
$('import-file').onchange = async () => {
  const file = $('import-file').files[0]; $('import-file').value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return notify('导入文件不能超过 2 MB。');
  try {
    const contents = JSON.parse(await file.text());
    if (state.game && !confirm(t('导入将替换相应的规则或对局，请确认已备份需要保留的记录。'))) return;
    await perform('import', {file: contents});
  } catch { notify('文件不是有效的 JSON。'); }
};
$('refresh').onclick = async () => {
  if (busy) return;
  if ((rulesDirty || draftDirty) && !confirm(t('重新读取会放弃页面中尚未保存的输入，继续？'))) return;
  clearTimeout(timer); busy = true; controller = new AbortController(); renderDisabled();
  try {
    if (saving) await saving.catch(() => {});
    await load(); $('storage-recovery').hidden = true; notify('');
  } catch (error) { showFailure(error); }
  finally { busy = false; render(); }
};
window.addEventListener('beforeunload', event => {
  if (rulesDirty || draftDirty || busy) { event.preventDefault(); event.returnValue = ''; }
});
const languageKey = 'pvz-helper:language:' + new URL(import.meta.env.BASE_URL, location.origin).pathname;
let preferenceStorage;
try { preferenceStorage = window.localStorage; } catch { /* Language still works for this visit. */ }
setLanguage(readLanguage(preferenceStorage, languageKey));
$('language').value = document.documentElement.lang = readLanguage(preferenceStorage, languageKey);
$('language').onchange = () => {
  setLanguage($('language').value);
  saveLanguage(preferenceStorage, languageKey, $('language').value);
  // Re-render from pending/localRules, preserving unsaved input and active work.
  if (state) render();
  translatePage();
};
state = store.snapshot(); localRules = structuredClone(state.rules); render();
busy = true; controller = new AbortController(); renderDisabled();
load().catch(showFailure).finally(() => {busy = false; render();});

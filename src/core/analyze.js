'use strict';
import {Model, State, Posterior} from './algorithms/pvz_solver.js';
import {propagate} from './algorithms/systematic_probe.js';
import {getAlgorithm} from './algorithms/registry.js';
import {canonical, validateTurn, fail} from './rules.js';

function opening(model) {
  const first = model.names.filter(q => q[0] === 'A');
  return [...first, ...model.names.filter(q => q[0] !== 'A')].slice(0, 10);
}
function turnSeed(seed, history) {
  let h = seed >>> 0;
  for (const turn of history)
    for (const c of turn.query.join('') + turn.response) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function analyze({legalRecipes, history, algorithmId, algorithmVersion, seed}) {
  if (!Array.isArray(legalRecipes)) fail('合法配方须为数组。');
  const legal = legalRecipes.map(canonical).sort();
  if (new Set(legal).size !== legal.length || legal.length < 10) fail('至少需要十个不同合法配方。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) fail('随机种子无效。');
  if (!Array.isArray(history) || history.length > 600) fail('对局历史格式无效或超过 600 轮。');
  const algorithm = getAlgorithm(algorithmId, algorithmVersion);
  const model = new Model(10, 10, legal), state = new State(model);
  const normalized = history.map(turn => validateTurn(turn, legal));
  let info, previousCount = null;
  for (let i = 0; i < normalized.length; i++) {
    try {
      if (state.done) throw Error('complete');
      if (algorithmId === 'joint' && i === normalized.length - 1) previousCount = new Posterior(state).count;
      state.update(model.encode(normalized[i].query), normalized[i].response);
      info = propagate(state);
    } catch {
      fail(`第 ${i + 1} 轮反馈与本局规则或前面的反馈矛盾。请核对蓝色优先、重复配方及已锁格。`);
    }
  }
  info ||= propagate(state);
  let next = null, remaining = null;
  if (!state.done) {
    if (!history.length) next = opening(model);
    else {
      const result = algorithm.recommend({state, seed: turnSeed(seed, normalized), previousCount});
      next = model.decode(result.query);
      remaining = result.remaining || null;
    }
  }
  return {
    done: state.done, next, remaining, history: normalized,
    locked: Object.fromEntries([...state.locked].map(([i, v]) => [i, model.names[v]])),
    candidates: info.domains.map(d => d.map(v => model.names[v])),
    present: [...info.present].map(v => model.names[v]),
    absent: [...info.absent].map(v => model.names[v])
  };
}
export {analyze, opening, turnSeed};

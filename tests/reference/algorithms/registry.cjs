'use strict';
const {RNG, Posterior, chooseQuery} = require('./pvz_solver.cjs');
const {advise} = require('./systematic_probe.cjs');
const {fail} = require('../rules.cjs');
// Add an entry here to expose a new algorithm in the UI. Increment its version
// when recommendation behavior changes, so old saves cannot silently change.
const algorithms = [
  {
    id: 'joint', version: '1.0.0', name: '联合抽样搜索',
    description: '优先减少尝试轮数。结合整行反馈，在完整候选答案中抽样搜索。',
    recommend({state, seed, previousCount}) {
      const p = new Posterior(state), rng = new RNG(seed);
      return {
        query: previousCount === p.count ? p.sample(rng) :
          chooseQuery(state, rng, {samples: 1024, sweeps: 2}, p),
        remaining: p.count.toString()
      };
    }
  },
  {
    id: 'probe', version: '1.0.0', name: '轻量探针',
    description: '计算更轻。精确排除不可能答案，再按反馈区分度选择探针。',
    recommend({state}) { return {query: advise(state).query}; }
  }
];
function getAlgorithm(id, version) {
  const algorithm = algorithms.find(a => a.id === id);
  if (!algorithm) fail('不支持这个算法，请使用当前版本的联合抽样搜索或轻量探针。');
  if (version !== undefined && version !== algorithm.version)
    fail('存档的算法版本与程序不一致，请使用创建此存档的程序版本。');
  return algorithm;
}
const descriptors = () => algorithms.map(({recommend, ...meta}) => meta);
module.exports = {algorithms, getAlgorithm, descriptors};

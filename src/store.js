import {blankRules, validateRules, validateDraft, legalRecipes, fail} from './core/rules.js';
import {getAlgorithm, descriptors} from './core/algorithms/registry.js';


const freshState = () => ({schemaVersion: 1, revision: 0, rules: blankRules(), game: null});
const now = () => new Date().toISOString();
const gameInput = game => ({legalRecipes: legalRecipes(game.rulesSnapshot), history: game.history,
  algorithmId: game.algorithmId, algorithmVersion: game.algorithmVersion, seed: game.seed});
function setAdvice(game, advice) {
  game.advice = advice;
  game.history = advice.history;
  game.pending = {query: advice.next ? [...advice.next] : game.history.at(-1)?.query || [],
    response: advice.next ? Array.from({length: 10}, (_, i) => advice.locked[i] ? 'G' : '-').join('') : 'GGGGGGGGGG'};
  game.status = advice.done ? 'completed' : 'active';
  game.updatedAt = now();
}
class Store {
  constructor(storage, calculate) {
    this.storage = storage; this.calculate = calculate;
    this.queue = Promise.resolve(); this.state = freshState();
  }
  async init(options = {}) {
    const saved = await this.storage.read();
    if (!saved) { this.state = freshState(); return; }
    if (saved.schemaVersion !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0)
      fail('存档版本或修订号不受支持，原数据已保留。');
    const restored = {schemaVersion: 1, revision: saved.revision,
      rules: validateRules(saved.rules), game: saved.game ? await this.restoreGame(saved.game, options) : null};
    this.state = restored;
  }
  async restoreGame(input, options = {}) {
    if (!input || typeof input !== 'object' || !['active', 'completed', 'ended'].includes(input.status))
      fail('对局存档状态无效。');
    getAlgorithm(input.algorithmId, input.algorithmVersion);
    if (typeof input.algorithmVersion !== 'string') fail('对局缺少算法版本。');
    const game = {id: typeof input.id === 'string' && input.id.length <= 80 ? input.id : crypto.randomUUID(),
      algorithmId: input.algorithmId, algorithmVersion: input.algorithmVersion, seed: input.seed,
      rulesSnapshot: validateRules(input.rulesSnapshot, true), history: input.history,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now(), updatedAt: now()};
    const advice = await this.calculate(gameInput(game), options);
    if ((input.status === 'completed') !== advice.done) fail('存档的完成状态与反馈历史不一致。');
    setAdvice(game, advice);
    game.status = input.status;
    game.pending = validateDraft(input.pending);
    for (const [i, q] of Object.entries(advice.locked))
      if (game.pending.query[i] !== q) fail('存档修改了已锁定槽位的植物。');
    return game;
  }
  snapshot() { return {...structuredClone(this.state), algorithms: descriptors()}; }
  action(input, options = {}) {
    const promise = this.queue.then(() => this.transact(input, options));
    this.queue = promise.catch(() => {});
    return promise;
  }
  async transact(input, options) {
    options.signal?.throwIfAborted();
    if (!input || input.revision !== this.state.revision)
      fail('页面状态已更新。请刷新页面再操作，未提交的输入可先复制保留。', 409);
    const next = structuredClone(this.state), game = next.game;
    const idle = () => { if (game?.status === 'active') fail('对局进行中，须先结束本局才能修改规则或导入存档。'); };
    const active = () => {
      if (!game || game.status !== 'active') fail('当前没有进行中的对局。');
      if (input.gameId !== game.id || input.round !== game.history.length + 1)
        fail('轮次已更新，请刷新后重试。', 409);
    };
    switch (input.type) {
      case 'rules':
        idle(); next.rules = validateRules(input.rules); break;
      case 'start': {
        idle();
        const rules = validateRules(next.rules, true), algo = getAlgorithm(input.algorithmId);
        const created = now();
        next.game = {id: crypto.randomUUID(), algorithmId: algo.id, algorithmVersion: algo.version,
          seed: crypto.getRandomValues(new Uint32Array(1))[0], rulesSnapshot: structuredClone(rules),
          history: [], createdAt: created, updatedAt: created};
        setAdvice(next.game, await this.calculate(gameInput(next.game), options));
        break;
      }
      case 'draft':
        active();
        game.pending = validateDraft(input.pending);
        for (const [i, q] of Object.entries(game.advice.locked))
          if (game.pending.query[i] !== q) fail('已锁格不能修改植物。');
        game.updatedAt = now();
        break;
      case 'submit':
        active();
        game.history.push(validateDraft(input.pending || game.pending));
        setAdvice(game, await this.calculate(gameInput(game), options));
        break;
      case 'undo': {
        if (!game || !game.history.length) fail('没有可以撤回的轮次。');
        if (input.gameId !== game.id) fail('对局已更新，请刷新。', 409);
        const removed = game.history.pop();
        setAdvice(game, await this.calculate(gameInput(game), options));
        game.pending = structuredClone(removed);
        break;
      }
      case 'end':
        active(); game.status = 'ended'; game.updatedAt = now(); break;
      case 'import': {
        idle();
        const file = input.file;
        if (!file || file.application !== 'pvz-helper' || file.schemaVersion !== 1)
          fail('不是受支持的 PVZ 助手 JSON 文件。');
        if (file.kind === 'rules') next.rules = validateRules(file.rules);
        else if (file.kind === 'session') {
          next.rules = validateRules(file.rules);
          next.game = file.game ? await this.restoreGame(file.game, options) : null;
        } else fail('不支持的导入类型。');
        break;
      }
      default: fail('未知操作。');
    }
    next.revision++;
    options.signal?.throwIfAborted();
    await this.storage.commit(next, this.state.revision);
    this.state = next;
    return this.snapshot();
  }
  export(kind) {
    const base = {application: 'pvz-helper', schemaVersion: 1, exportedAt: now(), kind};
    if (kind === 'rules') return {...base, rules: structuredClone(
      this.state.game?.status === 'active' ? this.state.game.rulesSnapshot : this.state.rules)};
    if (kind === 'session') return {...base, rules: structuredClone(this.state.rules), game: structuredClone(this.state.game)};
    fail('导出类型无效。');
  }
}
export {Store, freshState, gameInput};

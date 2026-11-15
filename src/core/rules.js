'use strict';
const MATERIALS = 'ABCDEFGHIJ'.split('');
const RECIPES = MATERIALS.flatMap((a, i) => MATERIALS.slice(i).map(b => a + b));
class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status) => { throw new AppError(message, status); };
function canonical(value) {
  if (typeof value !== 'string' || !/^[A-J]{2}$/.test(value.trim().toUpperCase()))
    fail('配方须由 A–J 中的两个字母组成，例如 AB 或 AA。');
  return value.trim().toUpperCase().split('').sort().join('');
}
function blankRules() {
  return {note: '', recipes: Object.fromEntries(RECIPES.map(q => [q, null]))};
}
function validateRules(input, complete = false) {
  if (!input || typeof input !== 'object' || typeof input.note !== 'string' ||
      input.note.length > 120 || !input.recipes || Array.isArray(input.recipes))
    fail('合成表格式不正确，版本备注最多 120 个字符。');
  const keys = Object.keys(input.recipes);
  if (keys.length !== 55 || !RECIPES.every(q => keys.includes(q)))
    fail('合成表必须包含 AA–JJ 的全部 55 个无序配方。');
  for (const q of RECIPES)
    if (![true, false, null].includes(input.recipes[q])) fail(`配方 ${q} 的状态无效。`);
  const rules = {note: input.note, recipes: Object.fromEntries(RECIPES.map(q => [q, input.recipes[q]]))};
  if (complete && RECIPES.some(q => rules.recipes[q] === null)) fail('请先确认全部 55 个组合是否合法。');
  if (complete && legalRecipes(rules).length < 10) fail('合法配方至少需要 10 个，才能组成十个互异答案。');
  return rules;
}
function legalRecipes(rules) { return RECIPES.filter(q => rules.recipes[q] === true); }
function validateTurn(turn, legal) {
  if (!turn || !Array.isArray(turn.query) || turn.query.length !== 10) fail('必须填写十个槽位。');
  const query = turn.query.map(canonical);
  for (const q of query) if (!legal.includes(q)) fail(`配方 ${q} 在本局合成表中不可合成。`);
  if (typeof turn.response !== 'string') fail('请录入十格反馈。');
  const response = turn.response.toUpperCase().replace(/\s/g, '');
  if (!/^[GBPX]{10}$/.test(response)) fail('请录入完整的十格反馈，仅使用 G、B、P、X。');
  return {query, response};
}
function validateDraft(input) {
  if (!input || !Array.isArray(input.query) || input.query.length !== 10 ||
      input.query.some(q => typeof q !== 'string' || q.length > 20) ||
      typeof input.response !== 'string' || input.response.length > 100)
    fail('本轮输入格式无效。');
  return {query: [...input.query], response: input.response};
}
export {MATERIALS, RECIPES, AppError, fail, canonical, blankRules, validateRules, legalRecipes, validateTurn, validateDraft};

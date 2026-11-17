// Presentation-only translations: game data and algorithm identifiers stay unchanged.
import english from './en.json' with {type: 'json'};
export let language = 'zh-CN';
const patterns = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const parts = key.split(/(\{\d+\})/);
  const slots = [];
  const source = parts.map(part => {
    if (/^\{\d+\}$/.test(part)) { slots.push(part); return '(.*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return {match: new RegExp('^' + source + '$', 's'), value, slots};
});
export function setLanguage(value) { language = value === 'en' ? 'en' : 'zh-CN'; }
export function t(value) {
  const text = String(value);
  if (language !== 'en') return text;
  if (Object.hasOwn(english, text)) return english[text];
  for (const {match, value, slots} of patterns) {
    const found = text.match(match);
    if (found) return value.replace(/\{\d+\}/g, token => found[slots.indexOf(token) + 1]);
  }
  return text;
}
export function readLanguage(storage, key) {
  try { return storage.getItem(key) === 'en' ? 'en' : 'zh-CN'; } catch { return 'zh-CN'; }
}
export function saveLanguage(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch { return false; }
}
// Remember source text per node so switching back restores Chinese. Values typed
// into inputs are never translated. No observer, HTML replacement or game writes.
const sources = new WeakMap();
function localize(target, name, read, write) {
  let entries = sources.get(target);
  if (!entries) sources.set(target, entries = new Map());
  const current = read();
  let entry = entries.get(name);
  if (!entry || current !== entry.result) entry = {source: current};
  const trimmed = entry.source.trim();
  entry.result = entry.source.replace(trimmed, () => t(trimmed));
  entries.set(name, entry);
  if (current !== entry.result) write(entry.result);
}
export function translatePage(root = document) {
  root.documentElement.lang = language;
  const walker = root.createTreeWalker(root.documentElement, 4);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement || node.parentElement.closest('script, style, textarea, select')) continue;
    localize(node, 'text', () => node.nodeValue, value => { node.nodeValue = value; });
  }
  for (const node of root.querySelectorAll('[aria-label], [placeholder], [title]')) {
    for (const name of ['aria-label', 'placeholder', 'title']) if (node.hasAttribute(name))
      localize(node, name, () => node.getAttribute(name), value => node.setAttribute(name, value));
  }
}

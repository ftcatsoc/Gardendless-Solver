// Keep stable A–J identifiers in the algorithm and version-1 archives.
const materials = 'ABCDEFGHIJ';
export const materialLabel = key => String(materials.indexOf(key) + 1);
export function recipeLabel(value) {
  return /^[A-J]{2}$/.test(value) ? [...value].map(materialLabel).join('+') : value;
}
export function recipeInput(value) {
  const match = value.match(/^\s*(10|[1-9])\s*[+＋]\s*(10|[1-9])\s*$/);
  if (match) return [materials[Number(match[1])-1], materials[Number(match[2])-1]].sort().join('');
  // Unfinished or invalid input stays in the draft so it can be corrected.
  if (/^[A-J]{2}$/i.test(value.trim())) return value.trim().toUpperCase().split('').sort().join('');
  return value;
}
export function recipeMessage(message) {
  return String(message)
    .replace('配方须由 A–J 中的两个字母组成，例如 AB 或 AA。', '配方须填写两个 1–10 的素材编号，用 + 分隔，例如 1+10 或 2+2。')
    .replace('合成表必须包含 AA–JJ 的全部 55 个无序配方。', '合成表必须包含素材 1–10 的全部 55 个无序配方。')
    .replace(/\b[A-J]{2}\b/g, recipeLabel);
}

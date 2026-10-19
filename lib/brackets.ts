export const BRACKETS = [500, 1000, 1500, 2000, 3000, 5000] as const;

// 橙〜茶の1色相の濃淡（安い = 淡い → 高い = 濃い）。運賃の段階は順序のある量なので、
// 虹色だと順序が読めない。背景地図（liberty）の水域の青・公園の緑と重ならない暖色にし、
// OKLCH の色相 62°→38° で明度を等間隔に下げて作った。いちばん淡い色でも地色
// （#f8f4f0）と住宅地のベージュに対して 2:1 を超える（dataviz の検証ツールで確認）
export const BRACKET_COLORS = [
  "#d8914e",
  "#c97730",
  "#b95e04",
  "#a54700",
  "#8c3500",
  "#732400",
  "#5a1300",
] as const;

// 運賃 → 色の添字。BRACKETS の上限を超えた場合は末尾（いちばん濃い色）を指すので、
// BRACKET_COLORS は BRACKETS より 1 要素多い。
export function bracketOf(fare: number): number {
  const i = BRACKETS.findIndex((max) => fare <= max);
  return i === -1 ? BRACKETS.length : i;
}

export function bracketLabel(i: number): string {
  const max = BRACKETS[i];
  if (max === undefined) return `${BRACKETS[BRACKETS.length - 1] ?? 0}円超`;
  return `〜${max}円`;
}

// 一覧を段階ごとの見出しで区切るため（見出しが凡例を兼ねる）。駅のない段階は見出しも出さない
export function groupByBracket<T extends { bracket: number }>(
  stations: T[],
): { bracket: number; stations: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const s of stations)
    groups.set(s.bracket, [...(groups.get(s.bracket) ?? []), s]);
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([bracket, stations]) => ({ bracket, stations }));
}

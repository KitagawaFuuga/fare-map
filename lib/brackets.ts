export const BRACKETS = [500, 1000, 1500, 2000, 3000, 5000] as const;

// 緑 → 黄 → 橙 → 赤 → 紫 → 青 → 灰（近い = 安い が直感的に分かる順）
export const BRACKET_COLORS = [
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#9333ea",
  "#2563eb",
  "#6b7280",
] as const;

export function bracketOf(fare: number): number {
  const i = BRACKETS.findIndex((max) => fare <= max);
  return i === -1 ? BRACKETS.length : i;
}

export function bracketLabel(i: number): string {
  const max = BRACKETS[i];
  if (max === undefined) return `${BRACKETS[BRACKETS.length - 1] ?? 0}円超`;
  return `〜${max}円`;
}

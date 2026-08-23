export type SheetState = "collapsed" | "half" | "full";

const ORDER: SheetState[] = ["collapsed", "half", "full"];

export function sheetNext(current: SheetState, dir: "up" | "down"): SheetState {
  const i = ORDER.indexOf(current) + (dir === "up" ? 1 : -1);
  return ORDER[Math.min(Math.max(i, 0), ORDER.length - 1)] ?? current;
}

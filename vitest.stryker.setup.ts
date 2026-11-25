import { vi } from "vitest";

// ミューテーションテストの中で全国の路線網（data/graph.json）を読ませない。
// 壊したコードが無限ループになると、本物の路線網の上で時間切れとメモリ切れを起こし、
// 計測全体が止まる（docs/ai-incidents.md 2026-11-24）。名前の検査
// （lib/__tests__/slow-test-naming.test.ts）はファイルの文字列しか見ないので、
// getGraphStore() 経由で読むテストはここで止める。
// 止めるのは readFileSync・fs/promises の readFile・JSON の import
// （vitest.stryker.config.ts）。createRequire 経由やファイル記述子での読み込みは止めない。
const MESSAGE =
  "ミューテーションテストでは data/graph.json を読めません。このテストは *.slow.test.ts の名前にしてください";
const isGraph = (file: unknown): boolean =>
  String(file).replaceAll("\\", "/").endsWith("data/graph.json");

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const guarded = ((file: unknown, ...rest: unknown[]) => {
    if (isGraph(file)) throw new Error(MESSAGE);
    return (fs.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync;
  return {
    ...fs,
    default: { ...fs, readFileSync: guarded },
    readFileSync: guarded,
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const guarded = ((file: unknown, ...rest: unknown[]) => {
    if (isGraph(file)) return Promise.reject(new Error(MESSAGE));
    return (fs.readFile as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFile;
  return { ...fs, default: { ...fs, readFile: guarded }, readFile: guarded };
});

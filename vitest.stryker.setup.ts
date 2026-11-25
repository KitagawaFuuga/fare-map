import { vi } from "vitest";

// ミューテーションテストの中で全国の路線網（data/graph.json）を読ませない。
// 壊したコードが無限ループになると、本物の路線網の上で時間切れとメモリ切れを起こし、
// 計測全体が止まる（docs/ai-incidents.md 2026-11-24）。名前の検査
// （lib/__tests__/slow-test-naming.test.ts）はファイルの文字列しか見ないので、
// getGraphStore() 経由で読むテストはここで止める。
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const guarded = ((file: unknown, ...rest: unknown[]) => {
    if (String(file).replaceAll("\\", "/").endsWith("data/graph.json")) {
      throw new Error(
        "ミューテーションテストでは data/graph.json を読めません。このテストは *.slow.test.ts の名前にしてください",
      );
    }
    return (fs.readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync;
  return {
    ...fs,
    default: { ...fs, readFileSync: guarded },
    readFileSync: guarded,
  };
});

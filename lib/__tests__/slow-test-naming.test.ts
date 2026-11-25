import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 全国の路線網（data/graph.json）を読むテストは *.slow.test.ts にする（CLAUDE.md）。
// ミューテーションテストはこの名前で外している。路線網を読むテストが混ざると、
// 壊したコードが実際の路線網の上で回り、時間切れやメモリ不足で全体が終わらなくなる。
const ROOTS = ["lib", "app", "components", "scripts"];
const GRAPH = "data/graph.json";
const SELF = "slow-test-naming.test.ts";

function testFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : testFiles(p);
    return e.name.endsWith(".test.ts") ? [p] : [];
  });
}

describe("重いテストの名前", () => {
  it("data/graph.json を読むテストは、名前が *.slow.test.ts になっている", () => {
    const offenders = ROOTS.flatMap(testFiles)
      .filter((f) => !f.endsWith(".slow.test.ts") && !f.endsWith(SELF))
      .filter((f) => readFileSync(f, "utf8").includes(GRAPH))
      .map((f) => f.split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });
});

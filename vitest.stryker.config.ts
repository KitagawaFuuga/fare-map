import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Stryker から流すときだけ使う（普段の設定は変えない）。
//
// 実データ（data/ の路線網・運賃表）を読むテストは外す。全国の路線網で最短距離を
// 計算するので普段でも1件数秒かかり、計測が入ると1件で数分になる。壊し方
// 約3000通りそれぞれで流し直すと終わらない（docs/decisions/0004-mutation-testing.md）。
// これらは普段の CI では流れている。ここで測るのは速いテストの検出力。
const REAL_DATA_TESTS = [
  "lib/__tests__/no-control-chars.test.ts",
  "lib/fare/__tests__/calculator.test.ts",
  "lib/fare/__tests__/fare-sources.test.ts",
  "lib/fare/__tests__/real-fares.test.ts",
  "lib/fare/__tests__/verify-candidate.test.ts",
  "lib/graph/__tests__/data-integrity.test.ts",
  "lib/graph/__tests__/kilometrage.test.ts",
  "lib/graph/__tests__/operator-alias.test.ts",
  "lib/server/__tests__/reachable-cache.test.ts",
  "lib/server/__tests__/reachable-route.test.ts",
  "lib/server/__tests__/reachable-walk-route.test.ts",
];

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: REAL_DATA_TESTS,
      // 計測が入ると遅くなるので、1件あたりの制限を既定の5秒から延ばす
      testTimeout: 60_000,
    },
  }),
);

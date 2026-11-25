import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Stryker から流すときだけ使う（普段の設定は変えない）。
//
// 名前が *.slow.test.ts のテストは外す。全国の路線網で探索を回す・リポジトリ全体を
// 読むなど1件が数秒かかり、壊し方約3000通りそれぞれで流し直すと終わらない
// （docs/decisions/0004-mutation-testing.md）。これらは普段の CI では流れている。
// 重いテストを足すときは、この名前にする。
export default mergeConfig(
  base,
  defineConfig({
    // JSON として import された路線網も止める（fs を通らないので setupFiles では止まらない）
    plugins: [
      {
        name: "block-graph-json",
        enforce: "pre",
        load(id: string) {
          if (
            id.replaceAll("\\", "/").split("?")[0]?.endsWith("data/graph.json")
          ) {
            throw new Error(
              "ミューテーションテストでは data/graph.json を読めません。このテストは *.slow.test.ts の名前にしてください",
            );
          }
          return null;
        },
      },
    ],
    test: {
      exclude: ["**/*.slow.test.ts"],
      // 名前を付け忘れても、路線網を読んだ時点で落とす
      setupFiles: ["./vitest.stryker.setup.ts"],
      // 計測が入ると遅くなるので、1件あたりの制限を既定の5秒から延ばす
      testTimeout: 60_000,
    },
  }),
);

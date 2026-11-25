// ミューテーションテスト（Stryker）の設定。lib/ のコードを機械的に壊し、
// テストがそれを捕まえられるかを測る（docs/decisions/0004-mutation-testing.md）。
// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  vitest: { configFile: "vitest.stryker.config.ts" },
  mutate: ["lib/**/*.ts", "!lib/**/__tests__/**"],
  // 壊した箇所を通るテストだけを流す。全テストを毎回流すと数千倍の時間がかかる
  coverageAnalysis: "perTest",
  // 最初に全テストを1回流してどのテストがどこを通るかを記録する。手元で約1分半
  // （2026-11-24）。GitHub の実行環境は遅いので、既定の5分では足りないことがある
  dryRunTimeoutMinutes: 10,
  // 型検査を外す対象を lib/ に限る。既定だと .claude/ の HTML まで読みに行って警告が出る
  disableTypeChecks: "lib/**/*.ts",
  reporters: ["clear-text", "progress", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  // 基準はまだ決めていない。週1回の計測を見てから決める（0004）
  thresholds: { high: 80, low: 60, break: null },
  // サンドボックスへのコピーから外す。テストが読まないもの
  ignorePatterns: [
    "data/raw",
    "e2e",
    "test-results",
    "playwright-report",
    "reports",
    ".next",
    ".superpowers",
    ".claude",
  ],
};

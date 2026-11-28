import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

// 指定されたら、手元でサーバーを立てずにその URL に対して走らせる。デプロイ時に
// 本番へ切り替える前の版を確かめるのに使う（.github/workflows/deploy.yml）。
// 空文字は未指定と同じに扱う（?? だと baseURL が "" になり、webServer も立たない）
const externalBaseURL = process.env.E2E_BASE_URL || undefined;

// WebKit（Safari の描画エンジン）でも流す。iPhone の利用者が多いので Chromium だけでは足りない
// （WebKit で流して、動き出す前に打った駅名が消える不具合を見つけた。PR #45）。
// ブラウザを入れる手間と時間が増えるので、E2E_WEBKIT を付けたとき（CI の e2e-webkit ジョブ）だけ足す。
// e2e-webkit も merge に必須のチェック。デプロイ前の確かめは Chromium だけで走る
const webkitProjects = process.env.E2E_WEBKIT
  ? [
      {
        name: "webkit",
        use: { ...devices["Desktop Safari"] },
        testIgnore: "**/mobile.spec.ts",
      },
      {
        name: "mobile-safari",
        use: { ...devices["iPhone 15"] },
        testMatch: ["**/mobile.spec.ts", "**/a11y.spec.ts"],
      },
    ]
  : [];

// E2E は本番ビルドに対して走らせる。maplibre のワーカー解決は dev と本番で
// 挙動が違い（Turbopack のチャンク URL が変わる）、検出したいのは本番側の
// 404 なので、dev サーバーでは意味がない。
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  // ボトムシート(md:hidden)はデスクトップ幅では描画されるが見えないので、
  // モバイル幅・タッチ有りの別プロジェクトを立てて触る。逆に既存の spec は
  // サイドバー(aside)前提なのでモバイル側では走らせない。
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/mobile.spec.ts",
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
      testMatch: ["**/mobile.spec.ts", "**/a11y.spec.ts"],
    },
    ...webkitProjects,
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        // E2E は全テストが同じ IP からサーバーを叩くので、既定のレート制限
        // (app/api/reachable/config.ts)に当たって落ちる。制限そのものは
        // lib/server/__tests__ で検証しているため、ここでは緩めておく。
        env: { RATE_LIMIT_CAPACITY: "1000" },
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});

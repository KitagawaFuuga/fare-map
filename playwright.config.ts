import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
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

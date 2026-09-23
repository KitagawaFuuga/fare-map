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
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

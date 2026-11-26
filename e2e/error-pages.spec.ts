import { test, expect, type Page } from "@playwright/test";

// 想定外のときの画面。Next.js の既定の画面は英語で、利用者が次に何をすればよいか分からない

const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e8e8e8" } },
  ],
};

async function stubTiles(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    if (route.request().url().includes("/styles/")) {
      await route.fulfill({ json: EMPTY_STYLE });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
}

test("無いページを開くと、404 で日本語の案内が出て、トップへ戻れる", async ({
  page,
}) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "トップへ戻る" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByPlaceholder("駅名を入力").first()).toBeVisible();
});

test("画面の表示中に失敗したら、日本語の案内が出て、やり直すと戻る", async ({
  page,
}) => {
  await stubTiles(page);
  // 地図のコード（maplibre を含むチャンク）だけを1回目は取れなくする。
  // デプロイの直後に古いチャンクを取りに行ったときや、回線が切れたときに起きる
  let blocked = false;
  let block = true;
  await page.route("**/_next/static/chunks/**", async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    if (block && body.includes("maplibre-gl-worker.mjs")) {
      blocked = true;
      await route.abort();
      return;
    }
    await route.fulfill({ response: res, body });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "表示できませんでした" }),
  ).toBeVisible({ timeout: 30_000 });
  expect(blocked).toBe(true);

  block = false;
  await page.getByRole("button", { name: "もう一度読み込む" }).click();
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 30_000,
  });
});

import { test, expect, type Page } from "@playwright/test";

// 地図タイルは外部サービス(tiles.openfreemap.org)から取る。CI を外部の障害や
// レート制限に晒さないため、スタイル定義とタイル本体は差し替える。検証したいのは
// 「maplibre がワーカーを解決できるか」であってタイルの中身ではない。
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

// 同じパネルがサイドバー(デスクトップ)とボトムシート(md:hidden)の2箇所に描画される。
// デスクトップ幅で走らせるので、サイドバー側だけを触る。
const sidebar = (page: Page) => page.locator("aside");

test("地図が初期化され、maplibre のワーカーが 404 にならない", async ({
  page,
}) => {
  // Turbopack のチャンク URL と node_modules 上の相対位置がずれると、maplibre の
  // ワーカーが 404 になりタイルが永久に読み込み中で止まる（過去に発生）。
  // ビルドも typecheck も通ってしまうため、ブラウザで開く以外に検出できない。
  const badResponses: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400 && /maplibre-gl.*\.mjs/.test(res.url())) {
      badResponses.push(`${res.status()} ${res.url()}`);
    }
  });
  const workerErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /worker|maplibre/i.test(msg.text())) {
      workerErrors.push(msg.text());
    }
  });

  await stubTiles(page);
  await page.goto("/");

  // ワーカーの解決に失敗すると maplibre は canvas を描かないまま止まる。
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 30_000,
  });

  const workerStatus = await page.evaluate(
    async () => (await fetch("/maplibre-gl-worker.mjs")).status,
  );
  expect(workerStatus, "public/ のワーカー実体が配信されていること").toBe(200);

  expect(badResponses).toEqual([]);
  expect(workerErrors).toEqual([]);
});

test("駅名を入力すると候補が出て、選ぶと出発駅になる", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");

  const suggestion = panel.getByRole("button", { name: /^新宿/ }).first();
  await expect(suggestion).toBeVisible({ timeout: 15_000 });
  await suggestion.click();

  await expect(panel.getByText("選択中: 新宿")).toBeVisible();
});

test("予算を入れて検索すると到達可能駅が出る", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();

  await panel.locator('input[type="number"]').fill("500");
  await panel.getByRole("button", { name: "検索" }).click();

  // 地図側は GeoJSON ソースに流し込むだけで DOM に要素が出ないため、
  // 件数の根拠は StationList の見出しに取る。
  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
});

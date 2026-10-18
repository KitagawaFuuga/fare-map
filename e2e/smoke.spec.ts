import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";

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

// 地図のスクリーンショットのうち、500円以下の駅の円の色（緑 #16a34a）の画素数。
// 地図側は GeoJSON ソースに描くだけで DOM に要素が出ないので、画素で数える。
async function greenPixels(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let k = 0; k < data.length; k += info.channels)
    if (
      Math.abs(data[k]! - 0x16) < 10 &&
      Math.abs(data[k + 1]! - 0xa3) < 10 &&
      Math.abs(data[k + 2]! - 0x4a) < 10
    )
      n++;
  return n;
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

  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();
});

test("地図をクリックしても出発駅は変わらない（出発駅は駅名の入力だけで決める）", async ({
  page,
}) => {
  // 以前は地図の空白クリックで最寄り駅が出発駅になり、駅の円を少し外して押すと
  // 意図せず出発駅が変わっていた
  await stubTiles(page);
  const nearestCalls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/stations/nearest")) nearestCalls.push(r.url());
  });
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();

  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  // 地図の load 後にクリックの処理が登録されるので、load を待ってから押す
  await page.waitForTimeout(3_000);
  await canvas.click({ position: { x: 200, y: 200 } });
  await page.waitForTimeout(2_000);

  expect(nearestCalls).toEqual([]);
  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();
});

test("現在地から出発駅を決めるボタンは無い", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "現在地から探す" }),
  ).toHaveCount(0);
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

test("徒歩連絡を前提とする運賃には印が付く", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await panel.locator('input[type="number"]').fill("500");
  // 印は運賃の表示より後に別の API（/api/reachable/walk）で届く
  const walkResponse = page.waitForResponse((r) =>
    r.url().includes("/api/reachable/walk?"),
  );
  await panel.getByRole("button", { name: "検索" }).click();

  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });

  // 新宿から500円圏には徒歩連絡でしか同じ運賃にならない駅が含まれる（代々木など）。
  // 印が付くこと、かつ全件には付かないこと（付けすぎていないこと）を確かめる。
  const badges = panel.getByText("徒歩あり");
  const rows = panel.locator("ul li");
  expect((await walkResponse).status()).toBe(200);
  await expect(badges.first()).toBeVisible();
  const badgeCount = await badges.count();
  const rowCount = await rows.count();
  expect(badgeCount).toBeGreaterThan(0);
  expect(badgeCount).toBeLessThan(rowCount);
});

test("地図の読み込みより先に検索結果が届いても、駅の円が描かれる", async ({
  page,
}) => {
  // 地図の load より先に結果が届くと、まだ GeoJSON ソースが無いので setData が
  // 空振りし、load で空のソースが作られて二度と描かれなかった（回線が遅い初回に発生）。
  // スタイルの応答を遅らせて、その間に検索を終える。
  test.setTimeout(60_000);
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    if (route.request().url().includes("/styles/")) {
      await new Promise((r) => setTimeout(r, 8_000));
      await route.fulfill({ json: EMPTY_STYLE });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await panel.locator('input[type="number"]').fill("500");
  await panel.getByRole("button", { name: "検索" }).click();
  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });

  // 円の色（500円以下の緑）の画素が地図に現れるまで待つ
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect
    .poll(async () => greenPixels(await canvas.screenshot()), {
      timeout: 30_000,
      intervals: [1_000],
    })
    .toBeGreaterThan(100);
});

test("初期表示の範囲外の駅から検索すると、地図が結果の駅へ移って円が見える", async ({
  page,
}) => {
  // 地図は東京を表示して始まる。検索しても地図が動かなかったので、黒崎駅前
  // （北九州）から検索すると一覧には結果が出るのに地図には何も描かれなかった。
  test.setTimeout(60_000);
  await stubTiles(page);
  await page.goto("/");

  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("黒崎駅前");
  await panel
    .getByRole("button", { name: /^黒崎駅前/ })
    .first()
    .click();
  await panel.locator('input[type="number"]').fill("230");
  await panel.getByRole("button", { name: "検索" }).click();
  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });

  // 一覧の駅は押さない（押すと地図が寄るので、検索だけで寄ることを確かめられない）
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect
    .poll(async () => greenPixels(await canvas.screenshot()), {
      timeout: 20_000,
      intervals: [1_000],
    })
    .toBeGreaterThan(30);
});

test("先の入力の候補が遅れて届いても、最新の入力の候補が表示される", async ({
  page,
}) => {
  // 「新」の応答が「新宿」の応答より後に届くと、候補が「新」の結果（新函館北斗など）
  // に戻っていた。古い応答を捨てずに setSuggestions していたため。
  await stubTiles(page);
  await page.route("**/api/stations?*", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "新") await new Promise((r) => setTimeout(r, 1_500));
    await route.continue();
  });
  await page.goto("/");

  const panel = sidebar(page);
  const input = panel.getByPlaceholder("駅名を入力");
  const first = page.waitForRequest(
    (r) => new URL(r.url()).searchParams.get("q") === "新",
  );
  await input.fill("新");
  await first; // デバウンスを越えて「新」の問い合わせが出たことを確かめる
  const lateResponse = page.waitForResponse(
    (r) => new URL(r.url()).searchParams.get("q") === "新",
  );
  await input.fill("新宿");
  await expect(panel.locator("ul li").first()).toContainText("新宿");
  await lateResponse; // 遅れた「新」の応答が届いたあとも

  const items = panel.locator("ul li");
  await expect(items.first()).toBeVisible();
  for (const text of await items.allInnerTexts())
    expect(text).toContain("新宿");
});

import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { BRACKET_COLORS } from "../lib/brackets";

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

// 地図のスクリーンショットのうち、500円以下の駅の円の色（BRACKET_COLORS[0]）の画素数。
// 地図側は GeoJSON ソースに描くだけで DOM に要素が出ないので、画素で数える。
const CHEAPEST = (BRACKET_COLORS[0].match(/[0-9a-f]{2}/gi) ?? []).map((h) =>
  parseInt(h, 16),
);
async function cheapestPixels(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let k = 0; k < data.length; k += info.channels)
    if (
      Math.abs(data[k]! - CHEAPEST[0]!) < 10 &&
      Math.abs(data[k + 1]! - CHEAPEST[1]!) < 10 &&
      Math.abs(data[k + 2]! - CHEAPEST[2]!) < 10
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

test("背景地図は色つきのスタイル（liberty）で、水域や公園が見分けられる", async ({
  page,
}) => {
  const styleUrls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/styles/")) styleUrls.push(r.url());
  });
  await stubTiles(page);
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  await expect.poll(() => styleUrls.length).toBeGreaterThan(0);
  expect(styleUrls[0]).toContain("/styles/liberty");
});

test("画面の文字は BIZ UDPゴシックで組まれる", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  const family = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  expect(family).toMatch(/BIZ[_ ]UDPGothic/);
});

test("出典欄に、CC BY のデータを加工して使っていることと ODbL のデータがあることが出る", async ({
  page,
}) => {
  // CC BY 4.0 は改変の有無の表示を、ODbL は派生物にその旨の表示を求める
  await stubTiles(page);
  await page.goto("/");
  const footer = sidebar(page).locator("footer");
  await expect(footer).toContainText("加工して使用");
  await expect(footer).toContainText("ODbL");
});

test("ファビコンとホーム画面用のアイコンがあり、どちらも実際に取得できる", async ({
  page,
  request,
}) => {
  await stubTiles(page);
  await page.goto("/");
  const icon = await page
    .locator('head link[rel="icon"][type="image/svg+xml"]')
    .getAttribute("href");
  const apple = await page
    .locator('head link[rel="apple-touch-icon"]')
    .getAttribute("href");
  expect(icon).not.toBeNull();
  expect(apple).not.toBeNull();
  for (const href of [icon!, apple!]) {
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});

test("サイドバーの見出しにアイコンと同じ形のロゴが付く", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  const heading = sidebar(page).getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("fare-map");
  await expect(heading.locator("svg")).toBeVisible();
});

test("入力欄は「〇〇から □□円で行ける駅」の文として読める", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  const panel = sidebar(page);
  await expect(panel.getByText("から", { exact: true })).toBeVisible();
  await expect(panel.getByText("円で行ける駅", { exact: true })).toBeVisible();
});

test("文の形の入力欄には見出しを重ねず、入力欄の名前は読み上げ用に持つ", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  const panel = sidebar(page);
  await expect(panel.getByText("出発駅", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/^予算: /)).toHaveCount(0);
  await expect(panel.getByRole("textbox", { name: "出発駅" })).toBeVisible();
  await expect(
    panel.getByRole("spinbutton", { name: "予算（円）" }),
  ).toBeVisible();
});

test("予算のスライダーは文の途中に挟まらず、文の下に置かれる", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  const panel = sidebar(page);
  const sentenceEnd = await panel
    .getByText("円で行ける駅", { exact: true })
    .boundingBox();
  const slider = await panel.getByRole("slider").boundingBox();
  expect(slider!.y).toBeGreaterThan(sentenceEnd!.y + sentenceEnd!.height);
});

test("検索ボタンは運賃の色と同じ系統の茶で塗られる", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  const button = sidebar(page).getByRole("button", {
    name: "検索",
    exact: true,
  });
  // #a54700（BRACKET_COLORS[3]）。白文字とのコントラストは 4.5:1 を超える
  await expect(button).toHaveCSS("background-color", "rgb(165, 71, 0)");
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

  // 円の色（500円以下の色）の画素が地図に現れるまで待つ
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect
    .poll(async () => cheapestPixels(await canvas.screenshot()), {
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
    .poll(async () => cheapestPixels(await canvas.screenshot()), {
      timeout: 20_000,
      intervals: [1_000],
    })
    .toBeGreaterThan(30);
});

// 黒崎駅前から予算230円で検索する（到達駅は八幡・陣原・熊西の3駅で、地図はそこへ寄る）
async function searchKurosaki(page: Page): Promise<void> {
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
}

test("一覧は運賃の段階ごとの見出しで区切られ、見出しが凡例を兼ねる", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto("/");
  const panel = sidebar(page);
  // 検索前は地図に点が無いので、段階の見出し（凡例）も出さない
  await expect(panel.getByText("〜500円")).toHaveCount(0);

  await panel.getByPlaceholder("駅名を入力").fill("黒崎駅前");
  await panel
    .getByRole("button", { name: /^黒崎駅前/ })
    .first()
    .click();
  // 600円なら 500円以下と 501〜1000円の2段階に分かれる
  await panel.locator('input[type="number"]').fill("600");
  await panel.getByRole("button", { name: "検索" }).click();
  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });
  const headings = panel.getByRole("heading", { level: 3 });
  await expect(headings).toHaveCount(2);
  await expect(headings.nth(0)).toHaveText(/^〜500円\s*\d+駅$/);
  await expect(headings.nth(1)).toHaveText(/^〜1000円\s*\d+駅$/);
});

test("一覧の駅を押すと、地図のその駅に吹き出しが出る", async ({ page }) => {
  test.setTimeout(60_000);
  await searchKurosaki(page);

  await sidebar(page).locator("li").filter({ hasText: "熊西" }).click();

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toContainText("熊西", { timeout: 10_000 });
  await expect(popup).toContainText("概算 230円");
});

test("出発駅を選ぶと、地図に出発駅の印が駅名つきで出る", async ({ page }) => {
  // 到達駅の一覧には出発駅自身が含まれないので、以前は地図のどこが起点か分からなかった
  await stubTiles(page);
  await page.goto("/");
  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("黒崎駅前");
  await panel
    .getByRole("button", { name: /^黒崎駅前/ })
    .first()
    .click();

  const marker = page.getByLabel("出発駅: 黒崎駅前");
  await expect(marker).toBeVisible({ timeout: 10_000 });
  await expect(marker).toContainText("黒崎駅前");
});

test("一覧の駅を押すと、その駅に選択中の印が出る", async ({ page }) => {
  test.setTimeout(60_000);
  await searchKurosaki(page);

  await sidebar(page).locator("li").filter({ hasText: "熊西" }).click();
  await expect(page.getByLabel("選択中の駅: 熊西")).toBeVisible({
    timeout: 10_000,
  });

  // 別の駅を選び直したら、印はそちらへ移る（前の駅の印は残らない）
  await sidebar(page).locator("li").filter({ hasText: "八幡" }).click();
  await expect(page.getByLabel("選択中の駅: 八幡")).toBeVisible();
  await expect(page.getByLabel("選択中の駅: 熊西")).toHaveCount(0);
});

test("駅の円は寄った地図で押しやすい大きさに描かれる", async ({ page }) => {
  // 以前は半径 5px 固定で小さかった。ズームに合わせて大きくする（寄った地図で約 10px）
  test.setTimeout(60_000);
  await searchKurosaki(page);

  // 3駅の円の画素の合計。半径 5px だと 1 駅あたり内側の 50 画素前後にしかならない
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect
    .poll(async () => cheapestPixels(await canvas.screenshot()), {
      timeout: 20_000,
      intervals: [1_000],
    })
    .toBeGreaterThan(400);
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

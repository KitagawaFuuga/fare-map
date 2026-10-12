import { test, expect, type Page, type Response } from "@playwright/test";

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

const sidebar = (page: Page) => page.locator("aside");

// 応答を受け取ってから画面に反映されるまでには時間差がある。0件を確かめる前に
// 本文の受信と React の描画（2フレーム）を待つ。待たないと反映前の0件で素通りする
async function afterResponseRendered(
  page: Page,
  response: Response,
): Promise<void> {
  await response.finished();
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
}

async function selectShinjuku(page: Page): Promise<void> {
  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  // 部分一致だと新宿三丁目などを選んでも通るので、完全一致で確かめる
  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();
}

test.describe("予算の境界値", () => {
  // API・スライダー・数値入力はすべて 100〜10000（lib/budget.ts）。
  // 画面から実際にその値を入れて、結果が出るか・エラーが出るかを確かめる。
  for (const budget of ["100", "10000"]) {
    test(`予算 ${budget} 円で結果が出る`, async ({ page }) => {
      // 結果を最大60秒待つので、テストの制限時間（既定30秒）も合わせる。
      // 並列で予算1万円の検索が重なると30秒を超え、確認の途中で打ち切られていた
      test.setTimeout(90_000);
      await stubTiles(page);
      await page.goto("/");
      await selectShinjuku(page);

      const panel = sidebar(page);
      await panel.locator('input[type="number"]').fill(budget);
      await panel.getByRole("button", { name: "検索" }).click();

      await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
        timeout: 60_000,
      });
      await expect(panel.locator("p.text-red-600")).toHaveCount(0);
    });
  }

  // 範囲外は API が 400 を返す。画面にエラーが出て、かつ黙って固まらないこと。
  test("予算 99 円はエラー表示になり、検索ボタンが復帰する", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.goto("/");
    await selectShinjuku(page);

    const panel = sidebar(page);
    await panel.locator('input[type="number"]').fill("99");
    const searchButton = panel.getByRole("button", { name: /検索/ });
    await searchButton.click();

    await expect(panel.locator("p.text-red-600")).toBeVisible({
      timeout: 15_000,
    });
    // 「検索中…」のまま固まらないこと
    await expect(panel.getByRole("button", { name: "検索" })).toBeEnabled();
  });

  test("予算 10001 円はエラー表示になり、検索ボタンが復帰する", async ({
    page,
  }) => {
    // number 入力の max は手入力や貼り付けを止めないので、API 側の上限が
    // 効いていることを画面から確かめる。
    await stubTiles(page);
    await page.goto("/");
    await selectShinjuku(page);

    const panel = sidebar(page);
    await panel.locator('input[type="number"]').fill("10001");
    await panel.getByRole("button", { name: /検索/ }).click();

    await expect(panel.locator("p.text-red-600")).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByRole("button", { name: "検索" })).toBeEnabled();
  });

  test("予算を空にしても操作不能にならない", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await selectShinjuku(page);

    const panel = sidebar(page);
    await panel.locator('input[type="number"]').fill("");
    await panel.getByRole("button", { name: /検索/ }).click();
    await expect(panel.getByRole("button", { name: /検索/ })).toBeEnabled({
      timeout: 15_000,
    });
  });
});

test.describe("駅名入力の境界値", () => {
  test("1文字でも候補が出る", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    const panel = sidebar(page);
    await panel.getByPlaceholder("駅名を入力").fill("東");
    await expect(panel.locator("ul li").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  // API の上限は 50 文字。超えても画面が壊れないこと（候補なしで済む）。
  test("51 文字入れても候補欄が出ずエラーにならない", async ({ page }) => {
    await stubTiles(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/");
    const panel = sidebar(page);
    // 固定の待ち時間のあとに0件を見るだけだと、応答が遅いときに素通りする。
    // 応答を待ってから確かめる
    const response = page.waitForResponse((r) =>
      r.url().includes("/api/stations?"),
    );
    await panel.getByPlaceholder("駅名を入力").fill("新".repeat(51));
    expect((await response).status()).toBe(400);
    await afterResponseRendered(page, await response);
    await expect(panel.locator("ul li")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("存在しない駅名では候補が出ない", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    const panel = sidebar(page);
    const response = page.waitForResponse((r) =>
      r.url().includes("/api/stations?"),
    );
    await panel.getByPlaceholder("駅名を入力").fill("ZZZZ存在しない駅ZZZZ");
    expect((await response).status()).toBe(200);
    await afterResponseRendered(page, await response);
    await expect(panel.locator("ul li")).toHaveCount(0);
  });

  // 駅名は外部データ由来なので、HTML として解釈されないこと。
  // 入力欄に HTML を打つだけでは該当駅が無く候補が0件になり、何も検証できない
  // （最初そう書いて素通りした）。API の応答を差し替えて、HTML を含む駅名が
  // 実際に候補として描画される状況を作る。
  test("駅名に含まれる HTML がマークアップとして解釈されない", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.route("**/api/stations?*", async (route) => {
      await route.fulfill({
        json: {
          stations: [
            {
              id: "x1",
              name: "<img src=x onerror=1>テスト駅",
              lineName: "<b>路線</b>",
              operator: "事業者",
            },
          ],
        },
      });
    });
    await page.goto("/");

    const panel = sidebar(page);
    await panel.getByPlaceholder("駅名を入力").fill("テスト");

    const item = panel.locator("ul li").first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    // タグが要素として生えていないこと
    await expect(panel.locator("ul li img")).toHaveCount(0);
    await expect(panel.locator("ul li b")).toHaveCount(0);
    // そのうえで、文字列としては見えていること（＝描画自体はされている）
    await expect(item).toContainText("<img src=x onerror=1>テスト駅");
  });
});

test.describe("エラーとキーボード操作", () => {
  test("検索 API が HTML のエラーページを返しても、分かる文言でエラー表示する", async ({
    page,
  }) => {
    // 前段のゲートウェイが 502 の HTML を返すと、JSON の解析エラー
    // 「Unexpected token '<' …」がそのまま表示されていた
    await stubTiles(page);
    await page.route("**/api/reachable?*", (route) =>
      route.fulfill({
        status: 502,
        contentType: "text/html",
        body: "<html><body>Bad Gateway</body></html>",
      }),
    );
    await page.goto("/");
    await selectShinjuku(page);

    const panel = sidebar(page);
    await panel.getByRole("button", { name: "検索" }).click();
    const error = panel.locator("p.text-red-600");
    await expect(error).toContainText("502");
    await expect(error).not.toContainText("JSON");
    await expect(panel.getByRole("button", { name: "検索" })).toBeEnabled();
  });

  test("駅名の候補を矢印キーと Enter で選べる", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    const panel = sidebar(page);
    const input = panel.getByPlaceholder("駅名を入力");
    await input.fill("新宿");
    await expect(panel.locator("ul li").first()).toContainText("新宿");

    await input.press("ArrowDown"); // 1件目（新宿）
    await page.keyboard.press("ArrowDown"); // 2件目
    await page.keyboard.press("ArrowUp"); // 1件目に戻る
    await page.keyboard.press("Enter");
    await expect(
      panel.getByText("選択中: 新宿", { exact: true }),
    ).toBeVisible();
  });
});

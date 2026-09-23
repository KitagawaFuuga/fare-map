import { test, expect, type Page } from "@playwright/test";

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

async function selectShinjuku(page: Page): Promise<void> {
  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await expect(panel.getByText("選択中: 新宿")).toBeVisible();
}

test.describe("予算の境界値", () => {
  // API は 100〜100000 を受け付ける。数値入力は同じ範囲、スライダーは上限 10000。
  // 画面から実際にその値を入れて、結果が出るか・エラーが出るかを確かめる。
  for (const budget of ["100", "100000"]) {
    test(`予算 ${budget} 円で結果が出る`, async ({ page }) => {
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

  // 100 未満は API が 400 を返す。画面にエラーが出て、かつ黙って固まらないこと。
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
    await page.goto("/");
    const panel = sidebar(page);
    await panel.getByPlaceholder("駅名を入力").fill("新".repeat(51));
    await page.waitForTimeout(1000);
    await expect(panel.locator("ul li")).toHaveCount(0);
  });

  test("存在しない駅名では候補が出ない", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    const panel = sidebar(page);
    await panel.getByPlaceholder("駅名を入力").fill("ZZZZ存在しない駅ZZZZ");
    await page.waitForTimeout(1000);
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

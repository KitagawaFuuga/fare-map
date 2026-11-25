import { test, expect, type Page } from "@playwright/test";

// 検索の結果（件数・0件・失敗）が、見た目だけでなくスクリーンリーダーにも伝わること。
// axe は「読み上げられるか」までは調べないので、役割（status・alert）をここで確かめる（WCAG 4.1.3）。

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

async function searchFrom(page: Page, station: string, budget: string) {
  const panel = sidebar(page);
  await panel.getByPlaceholder("駅名を入力").fill(station);
  await panel
    .getByRole("button", { name: new RegExp(`^${station}`) })
    .first()
    .click();
  await panel.locator('input[type="number"]').fill(budget);
  await panel.getByRole("button", { name: "検索" }).click();
}

test("検索結果の件数は、読み上げ用の status で伝わる", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/");
  await searchFrom(page, "新宿", "500");

  await expect(sidebar(page).getByRole("status")).toHaveText(
    /\d+ 駅に到達可能/,
    { timeout: 30_000 },
  );
});

test("行ける駅が無い予算で検索すると、何も出ないのではなく、そう伝える", async ({
  page,
}) => {
  // 黒崎駅前は徒歩でつながる駅が無く、100円では1駅も行けない
  await stubTiles(page);
  await page.goto("/");
  await searchFrom(page, "黒崎駅前", "100");

  await expect(sidebar(page).getByRole("status")).toHaveText(
    /行ける駅はありません/,
    { timeout: 30_000 },
  );
});

test("検索に失敗したら、alert で伝わる", async ({ page }) => {
  await stubTiles(page);
  await page.route("**/api/reachable?**", (route) =>
    route.fulfill({ status: 500, json: { error: "テスト用の失敗" } }),
  );
  await page.goto("/");
  await searchFrom(page, "新宿", "500");

  await expect(sidebar(page).getByRole("alert")).toHaveText("テスト用の失敗", {
    timeout: 30_000,
  });
});

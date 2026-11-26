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
  // 0件になる駅は運賃表や徒歩連絡の更新で変わるので、応答を差し替えて0件にする
  await stubTiles(page);
  await page.route("**/api/reachable?**", (route) =>
    route.fulfill({
      json: { stations: [], meta: { from: "x", budget: 100, count: 0 } },
    }),
  );
  await page.goto("/");
  await searchFrom(page, "新宿", "100");

  await expect(sidebar(page).getByRole("status")).toHaveText(
    /100円で行ける駅はありません/,
    { timeout: 30_000 },
  );
});

test("成功のあとに失敗したら、前の件数を出したままにしない", async ({
  page,
}) => {
  // 失敗しても前の結果は残る。件数の行がそのままだと、失敗した検索の結果として
  // 「N 駅に到達可能」が読み上げられ、エラーと食い違う
  await stubTiles(page);
  await page.goto("/");
  await searchFrom(page, "新宿", "500");
  const status = sidebar(page).getByRole("status");
  await expect(status).toHaveText(/\d+ 駅に到達可能/, { timeout: 30_000 });

  await page.route("**/api/reachable?**", (route) =>
    route.fulfill({ status: 500, json: { error: "テスト用の失敗" } }),
  );
  await sidebar(page).locator('input[type="number"]').fill("600");
  await sidebar(page).getByRole("button", { name: "検索" }).click();

  await expect(sidebar(page).getByRole("alert")).toHaveText("テスト用の失敗", {
    timeout: 30_000,
  });
  await expect(status).toHaveText("");
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

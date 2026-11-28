import { test, expect, type Page } from "@playwright/test";

// 画面はサーバーで描いてから、JS が届いて React が動き出す（ハイドレーション）。回線や端末が
// 遅いと、その間に入力欄へ文字を打てる。入力欄の値を React が持っていると、動き出したときに
// 空の値で上書きされ、打った駅名が消えて候補も出なかった（WebKit で見つけた。2026-11-27）

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

test("画面が動き出す前に駅名を打っても、消えずに候補が出る", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubTiles(page);
  // JS の到着を遅らせて、動き出す前に打てる時間を作る
  let delayed = 0;
  await page.route("**/_next/static/chunks/**", async (route) => {
    delayed++;
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const panel = page.locator("aside");
  const input = panel.getByPlaceholder("駅名を入力");
  await input.fill("新宿");

  await expect(
    panel.getByRole("button", { name: /^新宿/ }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(input).toHaveValue("新宿");
  expect(delayed).toBeGreaterThan(0);
});

test("画面が動き出す前に予算を打っても、その予算で検索する", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await stubTiles(page);
  await page.route("**/_next/static/chunks/**", async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  const panel = page.locator("aside");
  const budget = panel.getByRole("spinbutton", { name: "予算（円）" });
  await budget.fill("1000");

  // 動き出してから駅を選ぶ（候補が出れば動き出している）
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click({
    timeout: 30_000,
  });
  await expect(budget).toHaveValue("1000");
  await expect(panel.getByRole("slider", { name: "予算（円）" })).toHaveValue(
    "1000",
  );
  const request = page.waitForRequest((r) =>
    r.url().includes("/api/reachable?"),
  );
  await panel.getByRole("button", { name: "検索" }).click();
  expect(new URL((await request).url()).searchParams.get("budget")).toBe(
    "1000",
  );
});

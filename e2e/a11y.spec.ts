import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// アクセシビリティの自動検査（axe）。重さが serious・critical の違反があれば落とす。
// moderate・minor は落とさず、結果に添付して見えるようにする（0006 と同じく、
// 落とす基準は小さく始めて、直せたら上げる）。
// 自動検査で見つかるのは WCAG の一部だけ。キーボード操作や読み上げの確認の代わりにはならない。

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["serious", "critical"]);

const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#e8e8e8" } },
  ],
};

// 地図タイルは外部サービスなので差し替える（smoke.spec.ts と同じ）。
// 検査したいのは画面の DOM で、タイルの中身ではない。
async function stubTiles(page: Page): Promise<void> {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    if (route.request().url().includes("/styles/")) {
      await route.fulfill({ json: EMPTY_STYLE });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
}

async function checkA11y(page: Page, testInfo: TestInfo, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });

  const summary = (v: (typeof results.violations)[number]) =>
    `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}箇所: ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(" "))
      .join(" / ")})`;

  for (const v of results.violations.filter(
    (v) => !BLOCKING.has(v.impact ?? ""),
  ))
    testInfo.annotations.push({ type: "a11y", description: summary(v) });

  const blocking = results.violations
    .filter((v) => BLOCKING.has(v.impact ?? ""))
    .map(summary);
  expect(blocking, `${label} の serious・critical の違反`).toEqual([]);
}

test("開いた直後の画面に、重いアクセシビリティの違反が無い", async ({
  page,
}, testInfo) => {
  await stubTiles(page);
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 30_000,
  });
  await checkA11y(page, testInfo, "initial");
});

test("検索結果を出した画面に、重いアクセシビリティの違反が無い", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "検索の手順はデスクトップのサイドバーで組んでいる",
  );
  await stubTiles(page);
  await page.goto("/");

  const panel = page.locator("aside");
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await panel.locator('input[type="number"]').fill("500");
  await panel.getByRole("button", { name: "検索" }).click();
  await expect(panel.getByText(/\d+ 駅に到達可能/)).toBeVisible({
    timeout: 30_000,
  });

  await checkA11y(page, testInfo, "results");
});

test("無いページの案内に、重いアクセシビリティの違反が無い", async ({
  page,
}, testInfo) => {
  await page.goto("/no-such-page");
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
  await checkA11y(page, testInfo, "not-found");
});

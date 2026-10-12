import { test, expect, type Locator, type Page } from "@playwright/test";

// 地図タイルは外部サービス(tiles.openfreemap.org)から取る。CI を外部の障害や
// レート制限に晒さないため、スタイル定義とタイル本体は差し替える。
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

// 同じパネルがサイドバー(aside)とボトムシートの2箇所に描画される。
// モバイル幅では aside が非表示になるので、シート側だけを触る。
const sheet = (page: Page) => page.locator("div.fixed.bottom-0");

// React の onTouchStart / onTouchEnd を鳴らす。Playwright の touchscreen には
// スワイプが無いので、実際の TouchEvent を組み立てて投げる。
async function swipe(target: Locator, deltaY: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("シートが描画されていない");
  const startY = box.y + 10;
  await target.evaluate(
    (el, { startY, deltaY }) => {
      const touch = (y: number) =>
        new Touch({ identifier: 1, target: el, clientX: 100, clientY: y });
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          bubbles: true,
          touches: [touch(startY)],
        }),
      );
      el.dispatchEvent(
        new TouchEvent("touchend", {
          bubbles: true,
          changedTouches: [touch(startY + deltaY)],
        }),
      );
    },
    { startY, deltaY },
  );
}

const heightOf = async (target: Locator): Promise<number> => {
  const box = await target.boundingBox();
  if (!box) throw new Error("シートが描画されていない");
  return box.height;
};

// シートの高さは CSS の transition で変わるので、状態を変えた直後に測ると途中の
// 高さになる。畳んだ高さを縮む途中の 280px で測り、開き直した高さ（288px）と
// 比べて落ちていた（10回中2回）。続けて測った2回が同じになるまで待つ
async function settledHeightOf(target: Locator): Promise<number> {
  let prev = await heightOf(target);
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const cur = await heightOf(target);
    if (cur === prev) return cur;
    prev = cur;
  }
  throw new Error("シートの高さが落ち着かない");
}

async function selectShinjuku(page: Page): Promise<void> {
  const panel = sheet(page);
  await panel.getByPlaceholder("駅名を入力").fill("新宿");
  await panel.getByRole("button", { name: /^新宿/ }).first().click();
  await expect(panel.getByText("選択中: 新宿", { exact: true })).toBeVisible();
}

test.describe("ボトムシート", () => {
  test("モバイル幅ではシートが見え、サイドバーは隠れている", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.goto("/");

    await expect(sheet(page)).toBeVisible();
    await expect(page.locator("aside")).toBeHidden();
  });

  test("つまみをタップすると高さが変わる", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");

    const target = sheet(page);
    const before = await heightOf(target);
    await target.getByRole("button", { name: "シートを開閉" }).click();
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeGreaterThan(before);
  });

  test("上スワイプで広がり、下スワイプで縮む", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");

    const target = sheet(page);
    const initial = await heightOf(target);

    await swipe(target, -100); // 指を上へ
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeGreaterThan(initial);

    const opened = await settledHeightOf(target);
    await swipe(target, 100); // 指を下へ
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeLessThan(opened);
  });

  test("40px 未満の指ブレでは高さが変わらない", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");

    const target = sheet(page);
    const before = await heightOf(target);
    await swipe(target, -20);
    await page.waitForTimeout(500);
    expect(await heightOf(target)).toBe(before);
    // 対照: 閾値を超えるスワイプなら変わる。これが無いと、タッチの処理が
    // 効いていなくても「変わらない」で通ってしまう
    await swipe(target, -100);
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeGreaterThan(before);
  });

  test("シートから駅を選んで検索すると結果が出て、シートが畳まれる", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.goto("/");

    const target = sheet(page);
    await selectShinjuku(page);
    const beforeSearch = await heightOf(target);

    await target.getByRole("button", { name: "検索" }).click();
    await expect(target.getByText(/\d+ 駅に到達可能/)).toBeVisible({
      timeout: 60_000,
    });
    // 成功時は地図を主役にするため畳む(app/page.tsx)
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeLessThan(beforeSearch);
  });

  test("畳まれた状態からでもつまみで開き直せる", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");

    const target = sheet(page);
    const initial = await settledHeightOf(target);
    await swipe(target, 100); // half -> collapsed
    // 畳まれていないと、つまみで半分→全開になっても通ってしまうので先に確かめる
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeLessThan(initial);
    const collapsed = await settledHeightOf(target);

    await target.getByRole("button", { name: "シートを開閉" }).click();
    await expect
      .poll(() => heightOf(target), { timeout: 5_000 })
      .toBeGreaterThan(collapsed);
  });
});

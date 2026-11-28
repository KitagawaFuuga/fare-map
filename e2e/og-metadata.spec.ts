import { test, expect } from "@playwright/test";

// SNS やチャットに URL を貼ったときのカード。中身はサーバーが返す HTML の meta だけで
// 決まる（共有先は JS を動かさない）ので、ブラウザでなく HTTP の応答で確かめる
const meta = (html: string, attr: "property" | "name", key: string) => {
  const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`).exec(html);
  return m?.[1];
};

test("トップの HTML に、共有したときのタイトル・説明・画像が入っている", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();

  expect(meta(html, "property", "og:title")).toBe("fare-map");
  expect(meta(html, "property", "og:description")).toContain("予算");
  expect(meta(html, "property", "og:type")).toBe("website");
  expect(meta(html, "name", "twitter:card")).toBe("summary_large_image");

  // 共有先は相対 URL を解決しないので、本番の https の絶対 URL でなければならない
  const image = meta(html, "property", "og:image");
  expect(image).toMatch(/^https:\/\/[^/]+\.azurecontainerapps\.io\//);
  expect(meta(html, "property", "og:url")).toMatch(
    /^https:\/\/[^/]+\.azurecontainerapps\.io\/?$/,
  );

  // 画像そのものも配れること（パスは手元のサーバーで取る）
  const res = await request.get(new URL(image ?? "").pathname);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
});

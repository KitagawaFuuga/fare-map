import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/route-url/route";
import { RATE_LIMIT_CAPACITY } from "@/app/api/reachable/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (query: string, ip: string) =>
  GET(
    new NextRequest(`http://localhost/api/route-url?${query}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );

describe("GET /api/route-url", () => {
  // 駅すぱあとの API キーがあると、1 回ごとに外部 API を呼ぶ（回数の枠を使う）
  it("容量を超えて叩くと 429 を返す（検証より先に数える）", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "");
    const ip = "198.51.100.20";
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await call("from=", ip)).status).toBe(400);
    }
    const blocked = await call("from=", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // 別の IP は数えない
    expect((await call("from=新宿&to=高尾", "198.51.100.21")).status).toBe(302);
  });

  // 画面ではリンク（a href）から新しいタブで開くので、JSON ではなく転送で返す
  it("経路の検索のページへ 302 で転送する", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "");
    const res = await call(
      `from=${encodeURIComponent("新宿")}&to=${encodeURIComponent("高尾")}`,
      "198.51.100.22",
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://www.google.com/maps/dir/")).toBe(true);
    expect(decodeURIComponent(location)).toContain("destination=高尾駅");
  });

  // 新しいタブに出るので、JSON ではなく読める文にする
  it("入力が不正なら 400 で、日本語の文を返す", async () => {
    const res = await call("from=", "198.51.100.23");
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain("経路");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRouteUrl } from "@/lib/server/route-url";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildRouteUrl", () => {
  it("API キーが無ければ Google Maps transit リンクを返す", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "");
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toContain("google.com/maps/dir");
    expect(url).toContain("travelmode=transit");
    expect(url).toContain(encodeURIComponent("新宿駅"));
  });

  it("API キーがあれば駅すぱあとの ResourceURI を返す", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "testkey");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ ResultSet: { ResourceURI: "https://roote.ekispert.net/result?x=1" } }),
      }),
    );
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toBe("https://roote.ekispert.net/result?x=1");
  });

  it("駅すぱあとが失敗したら Google Maps にフォールバック", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "testkey");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toContain("google.com/maps/dir");
  });

  it("レスポンスの形が想定外（ResourceURI が数値）なら Google Maps にフォールバック", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "testkey");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ResultSet: { ResourceURI: 123 } }),
      }),
    );
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toContain("google.com/maps/dir");
    expect(url).toContain("travelmode=transit");
  });

  it("レスポンスの形が想定外（無関係なキー）なら Google Maps にフォールバック", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "testkey");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ foo: "bar" }),
      }),
    );
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toContain("google.com/maps/dir");
    expect(url).toContain("travelmode=transit");
  });

  it("ResourceURI が非 http(s) スキームなら Google Maps にフォールバック", async () => {
    vi.stubEnv("EKISPERT_API_KEY", "testkey");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ ResultSet: { ResourceURI: "javascript:alert(1)" } }),
      }),
    );
    const url = await buildRouteUrl("新宿", "高尾");
    expect(url).toContain("google.com/maps/dir");
    expect(url).toContain("travelmode=transit");
  });
});

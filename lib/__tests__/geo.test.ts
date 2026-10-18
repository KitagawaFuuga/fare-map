import { describe, expect, it } from "vitest";
import { boundsOf, haversineKm } from "@/lib/geo";

describe("haversineKm", () => {
  it("東京駅-新宿駅間が約6.5kmになる", () => {
    const tokyo = { lat: 35.681236, lng: 139.767125 };
    const shinjuku = { lat: 35.690921, lng: 139.700258 };
    const km = haversineKm(tokyo, shinjuku);
    expect(km).toBeGreaterThan(5.5);
    expect(km).toBeLessThan(7.5);
  });

  it("同一点は 0 を返す", () => {
    const p = { lat: 35, lng: 139 };
    expect(haversineKm(p, p)).toBe(0);
  });
});

describe("boundsOf", () => {
  it("全点を囲む [[西, 南], [東, 北]] を返す", () => {
    expect(
      boundsOf([
        { lat: 33.87, lng: 130.77 },
        { lat: 33.86, lng: 130.75 },
        { lat: 33.88, lng: 130.76 },
      ]),
    ).toEqual([
      [130.75, 33.86],
      [130.77, 33.88],
    ]);
  });

  it("点が無ければ null（到達駅が0件なら地図を動かさない）", () => {
    expect(boundsOf([])).toBeNull();
  });
});

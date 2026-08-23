import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/geo";

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

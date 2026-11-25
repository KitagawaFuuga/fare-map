import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getReachable } from "@/app/api/reachable/route";
import { GET as getWalk } from "@/app/api/reachable/walk/route";
import { RATE_LIMIT_CAPACITY } from "@/app/api/reachable/config";

// 実データ(data/graph.json)を読む。駅 id は JR山手線の新宿。
// 新宿から500円圏には徒歩連絡でしか同じ運賃にならない駅がある（代々木など）
const SHINJUKU = "1130208";

const request = (path: string, query: string, ip: string) =>
  new NextRequest(`http://localhost${path}?${query}`, {
    headers: { "x-forwarded-for": ip },
  });
const callReachable = (query: string, ip: string) =>
  getReachable(request("/api/reachable", query, ip));
const callWalk = (query: string, ip: string) =>
  getWalk(request("/api/reachable/walk", query, ip));

describe("GET /api/reachable/walk", () => {
  it("運賃の結果のうち、徒歩連絡を前提にした駅の id を返す", async () => {
    const query = `from=${SHINJUKU}&budget=500`;
    const fares = (await (
      await callReachable(query, "198.51.100.1")
    ).json()) as { stations: { id: string }[] };
    const res = await callWalk(query, "198.51.100.1");
    expect(res.status).toBe(200);
    const walk = (await res.json()) as {
      from: string;
      budget: number;
      viaWalkIds: string[];
    };
    expect(walk.from).toBe(SHINJUKU);
    expect(walk.budget).toBe(500);
    const ids = new Set(fares.stations.map((s) => s.id));
    expect(walk.viaWalkIds.length).toBeGreaterThan(0);
    expect(walk.viaWalkIds.length).toBeLessThan(ids.size);
    expect(walk.viaWalkIds.every((id) => ids.has(id))).toBe(true);
  }, 30000);

  it("容量を超えて叩くと 429 を返す（検証より先に数える）", async () => {
    const ip = "198.51.100.5";
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await callWalk("from=&budget=abc", ip)).status).toBe(400);
    }
    const blocked = await callWalk("from=&budget=abc", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("不正な入力は 400、存在しない駅は 404", async () => {
    expect((await callWalk("from=&budget=abc", "198.51.100.3")).status).toBe(
      400,
    );
    expect((await callWalk("from=x&budget=500", "198.51.100.3")).status).toBe(
      404,
    );
  });
});

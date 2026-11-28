import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/stations/route";
import {
  STATION_QUERY_MAX,
  STATIONS_RATE_LIMIT_CAPACITY,
} from "@/app/api/stations/config";

// 実データ(data/graph.json)を読む
const call = (q: string, ip: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/stations?q=${encodeURIComponent(q)}`,
      { headers: { "x-forwarded-for": ip } },
    ),
  );

describe("GET /api/stations", () => {
  it("いちばん長い駅名（24文字）でも、その駅が候補に出る", async () => {
    const longest = "計算科学センター（神戸どうぶつ王国・「富岳」前）";
    expect(longest.length).toBe(24);
    const res = await call(longest, "198.51.100.10");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stations: { name: string }[] };
    expect(body.stations.map((s) => s.name)).toContain(longest);
  });

  // 曖昧検索は長さにほぼ比例して重い（50文字で約 225ms、30文字で約 100ms。2026-11-27 に手元で測定）。
  // 駅名より長い入力は受けない
  it("上限より長い検索語は 400", async () => {
    expect(STATION_QUERY_MAX).toBeLessThanOrEqual(30);
    const ok = await call("あ".repeat(STATION_QUERY_MAX), "198.51.100.11");
    expect(ok.status).toBe(200);
    const tooLong = await call(
      "あ".repeat(STATION_QUERY_MAX + 1),
      "198.51.100.11",
    );
    expect(tooLong.status).toBe(400);
  });

  it("容量を超えて叩くと 429 を返す（検証より先に数える）", async () => {
    const ip = "198.51.100.12";
    for (let i = 0; i < STATIONS_RATE_LIMIT_CAPACITY; i++) {
      expect((await call("", ip)).status).toBe(400);
    }
    const blocked = await call("", ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // 別の IP は数えない
    expect((await call("新宿", "198.51.100.13")).status).toBe(200);
  });
});

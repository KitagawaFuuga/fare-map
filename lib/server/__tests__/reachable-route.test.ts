import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/reachable/route";
import {
  RATE_LIMIT_CAPACITY,
  reachableCacheKey,
} from "@/app/api/reachable/config";

// 実データ(data/graph.json)を読む。駅 id は JR山手線の新宿。
const SHINJUKU = "1130208";

const call = (query: string, ip: string) =>
  GET(
    new NextRequest(`http://localhost/api/reachable?${query}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );

describe("GET /api/reachable のレート制限", () => {
  it("同じ IP から容量を超えて叩くと 429 を返す", async () => {
    const ip = "203.0.113.1";
    const query = `from=${SHINJUKU}&budget=200`;
    // 容量ぶんは通る。2回目以降はキャッシュに当たるので探索は走らない。
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await call(query, ip)).status).toBe(200);
    }
    const blocked = await call(query, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // 最初の呼び出しがグラフの読み込みと探索を抱えるので、並列実行中は5秒を超えることがある
  }, 30000);

  it("別の IP は前の IP の消費に影響されない", async () => {
    const query = `from=${SHINJUKU}&budget=200`;
    expect((await call(query, "203.0.113.2")).status).toBe(200);
  });

  it("x-forwarded-for が複数ある場合は先頭のクライアント IP で数える", async () => {
    const query = `from=${SHINJUKU}&budget=200`;
    const ip = "203.0.113.3, 10.0.0.1, 10.0.0.2";
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await call(query, ip)).status).toBe(200);
    }
    // 末尾のプロキシ IP で数えていると、別クライアントを装っても弾かれない
    expect((await call(query, "203.0.113.3, 10.0.0.9")).status).toBe(429);
  });

  it("不正な入力でもトークンを消費し、枯渇後は 400 ではなく 429 を返す", async () => {
    // 検証を先に置くと、不正な入力を投げ続けるだけで無制限にリクエストを
    // 受け付けてしまう。課金はリクエスト数にも乗るので、制限を先に効かせる。
    const ip = "203.0.113.4";
    for (let i = 0; i < RATE_LIMIT_CAPACITY; i++) {
      expect((await call("from=&budget=abc", ip)).status).toBe(400);
    }
    expect((await call("from=&budget=abc", ip)).status).toBe(429);
  });
});

describe("reachableCacheKey", () => {
  it("from と budget の両方をキーに含める", () => {
    expect(reachableCacheKey("A", 100)).not.toBe(reachableCacheKey("A", 200));
    expect(reachableCacheKey("A", 100)).not.toBe(reachableCacheKey("B", 100));
  });

  it("同じ入力には同じキーを返す", () => {
    expect(reachableCacheKey("A", 100)).toBe(reachableCacheKey("A", 100));
  });
});

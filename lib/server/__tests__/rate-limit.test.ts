import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/server/rate-limit";

// 時刻はテストから注入する。実時間に依存させると回復の検証が sleep 待ちになる。
describe("createRateLimiter", () => {
  it("容量ぶんの連続リクエストは通す", () => {
    const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1 });
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(true);
  });

  it("容量を超えた次のリクエストは拒否する", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 1 });
    limiter.take("a", 0);
    limiter.take("a", 0);
    expect(limiter.take("a", 0)).toBe(false);
  });

  it("時間が経つとトークンが回復して再び通る", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 2 });
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(false);
    // refillPerSec: 2 なので 500ms で 1 トークン
    expect(limiter.take("a", 500)).toBe(true);
  });

  it("回復しても容量を超えて溜まらない", () => {
    const limiter = createRateLimiter({ capacity: 2, refillPerSec: 10 });
    limiter.take("a", 0);
    limiter.take("a", 0);
    // 1時間放置してもバケットは容量ぶんまで
    limiter.take("a", 3_600_000);
    limiter.take("a", 3_600_000);
    expect(limiter.take("a", 3_600_000)).toBe(false);
  });

  it("キーが違えばバケットは独立している", () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSec: 1 });
    expect(limiter.take("a", 0)).toBe(true);
    expect(limiter.take("a", 0)).toBe(false);
    expect(limiter.take("b", 0)).toBe(true);
  });

  it("追跡するキー数が上限を超えたら古いキーを捨てる", () => {
    // 上限が無いと、IP を変えて叩かれるだけでメモリが無限に増える。
    const limiter = createRateLimiter({
      capacity: 1,
      refillPerSec: 1,
      maxKeys: 2,
    });
    limiter.take("a", 0);
    limiter.take("b", 0);
    limiter.take("c", 0); // ここで最古の "a" が落ちる
    expect(limiter.size()).toBe(2);
    // "a" は忘れられているので満タンのバケットとして通る
    expect(limiter.take("a", 0)).toBe(true);
    // "c" は直前に消費済みなので拒否される
    expect(limiter.take("c", 0)).toBe(false);
  });
});

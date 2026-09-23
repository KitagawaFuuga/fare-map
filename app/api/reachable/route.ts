import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { reachable } from "@/lib/server/api-service";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { createResultCache } from "@/lib/server/result-cache";
import { MAX_BUDGET, MIN_BUDGET } from "@/lib/budget";
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RESULT_CACHE_ENTRIES,
  RETRY_AFTER_SEC,
  reachableCacheKey,
} from "./config";

// URL のクエリ文字列は必ず文字列で届くので z.coerce で数値化してから検証する。
// 上限はスライダーと同じ MAX_BUDGET。入力ミスや URL の手打ちで極端な予算が
// 渡された場合に、探索が始まる前に弾く（予算が大きいほど探索コストが跳ね上がる）。
const querySchema = z.object({
  from: z.string().min(1),
  budget: z.coerce.number().int().min(MIN_BUDGET).max(MAX_BUDGET),
});

// レート制限とキャッシュはモジュールレベルに置く。graph-store と同じく
// Next.js のサーバープロセスが生きている間だけ保持される揮発状態で、
// min-replicas 0 / 単一インスタンスの構成を前提にしている。
// proxy.ts (旧 middleware.ts) 側に置かないのは、Next.js のドキュメントが
// proxy は CDN に配置されうるため共有モジュールやグローバルに依存するなと
// 明記しているため。
const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});
const cache = createResultCache<unknown>(RESULT_CACHE_ENTRIES);

// Next.js 15 で NextRequest.ip が削除されたので、プロキシのヘッダから取る。
// x-forwarded-for は "client, proxy1, proxy2" の順に積まれるため先頭を使う。
// 末尾を使うとプロキシの IP で数えることになり、全クライアントが 1 バケットを
// 共有してしまう。
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export function GET(req: NextRequest) {
  // 検証より先に制限を掛ける。検証を先に置くと、不正な入力を投げ続けるだけで
  // 無制限にリクエストを受け付けてしまう。
  if (!limiter.take(clientIp(req), Date.now())) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。少し待って再試行してください" },
      { status: 429, headers: { "Retry-After": String(RETRY_AFTER_SEC) } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: sp.get("from"),
    budget: sp.get("budget"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: `from と budget(${MIN_BUDGET}〜${MAX_BUDGET}) を指定` },
      { status: 400 },
    );
  }
  const store = getGraphStore();
  // 形式は正しいが存在しない駅 id は「入力が不正(400)」ではなく「見つからない(404)」
  if (!store.graph.nodes[parsed.data.from]) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }

  const key = reachableCacheKey(parsed.data.from, parsed.data.budget);
  const hit = cache.get(key);
  if (hit !== undefined) return NextResponse.json(hit);

  const result = reachable(store, parsed.data.from, parsed.data.budget);
  cache.set(key, result);
  return NextResponse.json(result);
}

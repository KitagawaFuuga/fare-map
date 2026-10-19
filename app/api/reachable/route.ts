import { NextRequest, NextResponse } from "next/server";
import { getGraphStore } from "@/lib/server/graph-store";
import { createRateLimiter } from "@/lib/server/rate-limit";
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RETRY_AFTER_SEC,
} from "./config";
import { cachedReachable } from "./cache";
import { QUERY_ERROR, clientIp, querySchema } from "./query";

// レート制限はモジュールレベルに置く（運賃のキャッシュは cache.ts）。graph-store と同じく
// Next.js のサーバープロセスが生きている間だけ保持される揮発状態で、
// min-replicas 0 / 単一インスタンスの構成を前提にしている。
// proxy.ts (旧 middleware.ts) 側に置かないのは、Next.js のドキュメントが
// proxy は CDN に配置されうるため共有モジュールやグローバルに依存するなと
// 明記しているため。
const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

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
    return NextResponse.json({ error: QUERY_ERROR }, { status: 400 });
  }
  const store = getGraphStore();
  // 形式は正しいが存在しない駅 id は「入力が不正(400)」ではなく「見つからない(404)」
  if (!store.graph.nodes[parsed.data.from]) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }

  return NextResponse.json(
    cachedReachable(store, parsed.data.from, parsed.data.budget),
  );
}

import { NextRequest, NextResponse } from "next/server";
import { getGraphStore } from "@/lib/server/graph-store";
import { walkStationIds } from "@/lib/server/api-service";
import { createRateLimiter } from "@/lib/server/rate-limit";
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RETRY_AFTER_SEC,
} from "../config";
import { QUERY_ERROR, clientIp, querySchema } from "../query";
import { cachedReachable } from "../cache";

// 運賃が徒歩連絡を前提にしている駅の id（lib/server/api-service.ts の WalkResult）。
// 画面は運賃（/api/reachable）を先に表示し、このあとで「徒歩あり」の印を付ける。
//
// 運賃の検索とは別のバケツで数える。同じバケツだと1回の検索で2トークン使い、
// 運賃の検索が以前の半分の回数で 429 になる。別にしても1人あたりの探索の回数は、
// 1回の検索で2回探索していた以前と同じ。
const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

export function GET(req: NextRequest) {
  // 運賃のルートと同じく、検証より先に数える
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
  const { from, budget } = parsed.data;
  const store = getGraphStore();
  if (!store.graph.nodes[from]) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }
  // 運賃は通常、直前の /api/reachable でキャッシュ済み。無ければ探索し直す
  const result = cachedReachable(store, from, budget);
  return NextResponse.json({
    from,
    budget,
    viaWalkIds: walkStationIds(store, result),
  });
}

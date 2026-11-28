import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { suggestStations } from "@/lib/server/api-service";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { clientIp } from "../reachable/query";
import {
  STATION_QUERY_MAX,
  STATIONS_RATE_LIMIT_CAPACITY,
  STATIONS_RATE_LIMIT_REFILL_PER_SEC,
  STATIONS_RETRY_AFTER_SEC,
} from "./config";

// q は検索語（Web 全体の慣例に合わせた URL パラメータ名）。
// 未指定だと searchParams.get は null を返すので、min(1) が「空」と「欠落」の
// 両方をまとめて弾く。上限は曖昧検索が重くなるのを防ぐ長さ（config.ts）。
const querySchema = z.object({ q: z.string().min(1).max(STATION_QUERY_MAX) });

// 探索（app/api/reachable/route.ts）と同じく、プロセスが生きている間だけ持つ揮発状態
const limiter = createRateLimiter({
  capacity: STATIONS_RATE_LIMIT_CAPACITY,
  refillPerSec: STATIONS_RATE_LIMIT_REFILL_PER_SEC,
});

export function GET(req: NextRequest) {
  // 検証より先に数える。後にすると、不正な入力を投げ続けるだけで制限を受けない
  if (!limiter.take(clientIp(req), Date.now())) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。少し待って再試行してください" },
      {
        status: 429,
        headers: { "Retry-After": String(STATIONS_RETRY_AFTER_SEC) },
      },
    );
  }

  const parsed = querySchema.safeParse({
    q: req.nextUrl.searchParams.get("q"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: `q は 1〜${STATION_QUERY_MAX} 文字で指定` },
      { status: 400 },
    );
  }
  return NextResponse.json({
    stations: suggestStations(getGraphStore(), parsed.data.q),
  });
}

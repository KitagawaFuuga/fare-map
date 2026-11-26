import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildRouteUrl } from "@/lib/server/route-url";
import { createRateLimiter } from "@/lib/server/rate-limit";
import { clientIp } from "../reachable/query";
import {
  RATE_LIMIT_CAPACITY,
  RATE_LIMIT_REFILL_PER_SEC,
  RETRY_AFTER_SEC,
} from "../reachable/config";

const querySchema = z.object({
  from: z.string().min(1).max(50),
  to: z.string().min(1).max(50),
});

// 駅すぱあとの API キーがあると、1 回ごとに外部 API を呼ぶ（キーの回数の枠を使う）。
// 経路のリンクは駅を選んだときだけ取るので、探索と同じ控えめな値で足りる
const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

export async function GET(req: NextRequest) {
  // 検証より先に数える。後にすると、不正な入力を投げ続けるだけで制限を受けない
  if (!limiter.take(clientIp(req), Date.now())) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。少し待って再試行してください" },
      { status: 429, headers: { "Retry-After": String(RETRY_AFTER_SEC) } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: sp.get("from"),
    to: sp.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "from/to を指定" }, { status: 400 });
  }
  const url = await buildRouteUrl(parsed.data.from, parsed.data.to);
  return NextResponse.json({ url });
}

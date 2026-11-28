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

// 吹き出しの「経路を見る」のリンク先。乗換案内のページへ 302 で転送する。
// 駅すぱあとの API キーがあると、1 回ごとに外部 API を呼ぶ（キーの回数の枠を使う）。
// 経路のリンクは駅を選んだときだけ取るので、探索と同じ控えめな値で足りる
const limiter = createRateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

export async function GET(req: NextRequest) {
  // 検証より先に数える。後にすると、不正な入力を投げ続けるだけで制限を受けない
  if (!limiter.take(clientIp(req), Date.now())) {
    return text(
      "経路を開くリクエストが多すぎます。少し待ってから、もう一度押してください。",
      429,
      { "Retry-After": String(RETRY_AFTER_SEC) },
    );
  }

  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: sp.get("from"),
    to: sp.get("to"),
  });
  if (!parsed.success) {
    return text(
      "経路を開けませんでした（出発駅と到着駅の指定がありません）。",
      400,
    );
  }
  // 転送先は、こちらで組み立てた Google マップの URL か、駅すぱあとが返した
  // http(s) の URL だけ（lib/server/route-url.ts）。任意の場所へ飛ばす転送にはならない
  const url = await buildRouteUrl(parsed.data.from, parsed.data.to);
  return NextResponse.redirect(url, 302);
}

// 画面のリンクから新しいタブで開くので、失敗も JSON ではなく読める文で返す
function text(
  body: string,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

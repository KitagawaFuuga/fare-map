import type { NextRequest } from "next/server";
import { z } from "zod";
import { MAX_BUDGET, MIN_BUDGET } from "@/lib/budget";

// 運賃（route.ts）と徒歩ありの判定（walk/route.ts）で共有する入力検証。
// URL のクエリ文字列は必ず文字列で届くので z.coerce で数値化してから検証する。
// 上限はスライダーと同じ MAX_BUDGET。入力ミスや URL の手打ちで極端な予算が
// 渡された場合に、探索が始まる前に弾く（予算が大きいほど探索コストが跳ね上がる）。
export const querySchema = z.object({
  from: z.string().min(1),
  budget: z.coerce.number().int().min(MIN_BUDGET).max(MAX_BUDGET),
});

export const QUERY_ERROR = `from と budget(${MIN_BUDGET}〜${MAX_BUDGET}) を指定`;

// Next.js 15 で NextRequest.ip が削除されたので、プロキシのヘッダから取る。
// x-forwarded-for は "client, proxy1, proxy2" の順に積まれるため先頭を使う。
// 末尾を使うとプロキシの IP で数えることになり、全クライアントが 1 バケットを
// 共有してしまう。
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

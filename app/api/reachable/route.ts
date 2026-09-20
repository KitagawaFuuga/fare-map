import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { reachable } from "@/lib/server/api-service";

// URL のクエリ文字列は必ず文字列で届くので z.coerce で数値化してから検証する。
// max(100000) は入力ミスや URL の手打ちで極端な予算が渡された場合に、
// 探索が始まる前に弾くための上限（予算が大きいほど探索コストが跳ね上がる）。
const querySchema = z.object({
  from: z.string().min(1),
  budget: z.coerce.number().int().min(100).max(100000),
});

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    from: sp.get("from"),
    budget: sp.get("budget"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "from と budget(100〜100000) を指定" },
      { status: 400 },
    );
  }
  const store = getGraphStore();
  // 形式は正しいが存在しない駅 id は「入力が不正(400)」ではなく「見つからない(404)」
  if (!store.graph.nodes[parsed.data.from]) {
    return NextResponse.json({ error: "未知の駅 id" }, { status: 404 });
  }
  return NextResponse.json(
    reachable(store, parsed.data.from, parsed.data.budget),
  );
}

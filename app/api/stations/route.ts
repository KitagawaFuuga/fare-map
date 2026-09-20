import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { suggestStations } from "@/lib/server/api-service";

// q は検索語（Web 全体の慣例に合わせた URL パラメータ名）。
// 未指定だと searchParams.get は null を返すので、min(1) が「空」と「欠落」の
// 両方をまとめて弾く。max(50) は異常に長い入力で曖昧検索が重くなるのを防ぐ上限。
const querySchema = z.object({ q: z.string().min(1).max(50) });

export function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({
    q: req.nextUrl.searchParams.get("q"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "q は 1〜50 文字で指定" },
      { status: 400 },
    );
  }
  return NextResponse.json({
    stations: suggestStations(getGraphStore(), parsed.data.q),
  });
}

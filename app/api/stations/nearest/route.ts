import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { nearestStation } from "@/lib/server/api-service";

// 日本国内のおおよその緯度経度範囲。範囲外（海外・不正値）はここで弾き、
// 全駅総当たりの最寄り駅探索に到達させない。
const querySchema = z.object({
  lat: z.coerce.number().min(20).max(46),
  lng: z.coerce.number().min(122).max(154),
});

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    lat: sp.get("lat"),
    lng: sp.get("lng"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "lat/lng が日本国内の範囲外" },
      { status: 400 },
    );
  }
  const { lat, lng } = parsed.data;
  return NextResponse.json({
    station: nearestStation(getGraphStore(), lat, lng),
  });
}

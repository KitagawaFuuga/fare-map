import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGraphStore } from "@/lib/server/graph-store";
import { suggestStations } from "@/lib/server/api-service";

const querySchema = z.object({ q: z.string().min(1).max(50) });

export function GET(req: NextRequest) {
  const parsed = querySchema.safeParse({ q: req.nextUrl.searchParams.get("q") });
  if (!parsed.success) {
    return NextResponse.json({ error: "q は 1〜50 文字で指定" }, { status: 400 });
  }
  return NextResponse.json({ stations: suggestStations(getGraphStore(), parsed.data.q) });
}

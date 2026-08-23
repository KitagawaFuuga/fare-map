import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildRouteUrl } from "@/lib/server/route-url";

const querySchema = z.object({ from: z.string().min(1).max(50), to: z.string().min(1).max(50) });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ from: sp.get("from"), to: sp.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ error: "from/to を指定" }, { status: 400 });
  }
  const url = await buildRouteUrl(parsed.data.from, parsed.data.to);
  return NextResponse.json({ url });
}

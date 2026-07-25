import { NextResponse } from "next/server";
import { env } from "~/env";
import { refreshSellSideOverview } from "~/server/application/overview/sell-side-overview-service";

export async function POST(request: Request) {
  const secret = env.SELL_SIDE_REFRESH_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await refreshSellSideOverview());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "刷新失败" },
      { status: 502 },
    );
  }
}

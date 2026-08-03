import { db } from "~/server/db";

export async function GET() {
  try {
    const projection = await db.homepageCurrentSnapshotProjection.findFirst({
      where: { scope: "BASELINE", userId: null },
      select: { snapshotId: true },
    });
    return projection
      ? Response.json({ status: "ready", snapshotId: projection.snapshotId })
      : Response.json(
          { status: "waiting_for_baseline_snapshot" },
          { status: 503 },
        );
  } catch {
    return Response.json({ status: "database_unavailable" }, { status: 503 });
  }
}

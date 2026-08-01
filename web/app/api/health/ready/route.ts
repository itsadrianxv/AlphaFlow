import { db } from "~/server/db";

export async function GET() {
  try {
    const snapshot = await db.homePageSnapshot.findFirst({
      where: { scope: "DEFAULT" },
      select: { id: true },
    });
    return snapshot
      ? Response.json({ status: "ready", snapshotId: snapshot.id })
      : Response.json(
          { status: "waiting_for_default_snapshot" },
          { status: 503 },
        );
  } catch {
    return Response.json({ status: "database_unavailable" }, { status: 503 });
  }
}

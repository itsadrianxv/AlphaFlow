import { redirect } from "next/navigation";
import { requireAuth } from "~/server/auth/require-auth";

export default async function WatchlistsPage() {
  await requireAuth("/watchlists");
  redirect("/research-targets");
}

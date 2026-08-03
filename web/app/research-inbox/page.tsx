import { ResearchInboxClient } from "~/app/research-inbox/research-inbox-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function ResearchInboxPage() {
  await requireAuth("/research-inbox");
  return <ResearchInboxClient />;
}

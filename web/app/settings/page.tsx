import { SettingsClient } from "~/app/settings/settings-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function SettingsPage() {
  await requireAuth("/settings");
  return <SettingsClient />;
}

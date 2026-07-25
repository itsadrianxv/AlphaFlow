import { SellSideExpectationsClient } from "~/app/sell-side-expectations/sell-side-expectations-client";
import { requireAuth } from "~/server/auth/require-auth";

export default async function SellSideExpectationsPage() {
  await requireAuth("/sell-side-expectations");

  return <SellSideExpectationsClient />;
}

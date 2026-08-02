import { Suspense } from "react";

import { MarketBaselinePrototype } from "~/app/market-context/prototype/market-baseline-prototype";
import { requireAuth } from "~/server/auth/require-auth";

export default async function MarketBaselinePrototypePage() {
  await requireAuth("/market-context/prototype");

  return (
    <Suspense fallback={null}>
      <MarketBaselinePrototype />
    </Suspense>
  );
}

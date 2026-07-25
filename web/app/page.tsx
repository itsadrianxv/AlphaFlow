import { Suspense } from "react";

import { HighlightToNote } from "~/app/_components/highlight-to-note";
import { ImpactMappingWorkspace } from "~/app/_components/impact-mapping-workspace";
import { OverviewInsightsPanel } from "~/app/_components/overview-insights-panel";
import { WorkspaceShell } from "~/app/_components/ui";
import { PiAgentComposer } from "~/app/agent-runtime/agent-runtime-client";
import { MarketHeatmapClient } from "~/app/heatmap/market-heatmap-client";
import { requireAuth } from "~/server/auth/require-auth";
import { HydrateClient } from "~/trpc/server";

export default async function Home() {
  const session = await requireAuth("/");
  const signedIn = Boolean(session.user);

  return (
    <HydrateClient>
      <WorkspaceShell section="home" showHistory={false}>
        <HighlightToNote floatingToolbar source={{ kind: "overview" }}>
          <div className="grid min-h-full xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0">
              <MarketHeatmapClient />
            </div>
            <OverviewInsightsPanel />
            <div className="min-w-0 xl:col-span-2">
              <ImpactMappingWorkspace signedIn={signedIn} />
            </div>
          </div>
        </HighlightToNote>
        {signedIn ? (
          <div className="pb-[144px]">
            <Suspense fallback={null}>
              <PiAgentComposer showConversation={false} />
            </Suspense>
          </div>
        ) : null}
      </WorkspaceShell>
    </HydrateClient>
  );
}

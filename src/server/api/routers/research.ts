import { researchOpportunitiesRouter } from "~/modules/research/server/api/opportunities-router";
import { researchRemindersRouter } from "~/modules/research/server/api/reminders-router";
import { researchRunsRouter } from "~/modules/research/server/api/runs-router";
import { researchSpacesRouter } from "~/modules/research/server/api/spaces-router";
import { createTRPCRouter } from "~/platform/trpc/server";

export const researchRouter = createTRPCRouter({
  runs: researchRunsRouter,
  spaces: researchSpacesRouter,
  reminders: researchRemindersRouter,
  opportunities: researchOpportunitiesRouter,
});

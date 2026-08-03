import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentConfirmationTokenService } from "~/server/application/agent-runtime/confirmation-token-service";

const bindingSchema = z
  .object({
    intentId: z.string().trim().min(1),
    intentType: z.string().trim().min(1),
    objectIdentities: z
      .array(
        z.object({
          type: z.string().trim().min(1),
          id: z.string().trim().min(1),
        }),
      )
      .min(1)
      .max(100),
    payload: z.record(z.unknown()),
    channel: z.string().trim().min(1),
    sideEffectKind: z.string().trim().min(1),
  })
  .strict();

export const agentConfirmationRouter = createTRPCRouter({
  issue: protectedProcedure
    .input(bindingSchema)
    .mutation(async ({ ctx, input }) =>
      new AgentConfirmationTokenService(ctx.db).issue({
        ...input,
        userId: ctx.session.user.id,
      }),
    ),
});

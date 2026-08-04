import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentConversationService } from "~/server/application/agent-runtime/agent-conversation-service";
import { AgentRuntimeCommandService } from "~/server/application/agent-runtime/agent-runtime-command-service";
import { AgentRuntimeQueryService } from "~/server/application/agent-runtime/agent-runtime-query-service";
import {
  MAX_SELECTED_SKILLS_MESSAGE,
  normalizeSelectedSkillIds,
} from "~/server/application/agent-runtime/skill-selection";
import {
  USER_SKILL_MAX_CHARS,
  UserSkillService,
} from "~/server/application/agent-runtime/user-skill-service";
import { ScheduledTaskIntentRouter } from "~/server/application/scheduled-task/scheduled-task-intent-router";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import { isWorkflowDomainError } from "~/server/domain/workflow/errors";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error;
  }

  if (isWorkflowDomainError(error)) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
    });
  }

  if (
    error instanceof Error &&
    (error.message === "请选择 skill" ||
      error.message === MAX_SELECTED_SKILLS_MESSAGE)
  ) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
    });
  }

  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "未知 agent-runtime 错误",
  });
}

const startRunInput = z
  .object({
    skillId: z.string().trim().min(1).optional(),
    skillIds: z
      .array(z.string().trim().min(1))
      .max(3, MAX_SELECTED_SKILLS_MESSAGE)
      .optional(),
    prompt: z.string().trim().min(1),
    title: z.string().trim().min(1).max(120).optional(),
    conversationId: z.string().cuid().optional(),
    userMessageId: z.string().cuid().optional(),
    assistantMessageId: z.string().cuid().optional(),
    context: z.record(z.unknown()).optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .refine((value) => value.skillId || (value.skillIds?.length ?? 0) > 0, {
    message: "请选择 skill",
  });

const listRunsInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const runIdInput = z.object({
  runId: z.string().cuid(),
});

const userSkillIdInput = z.object({
  skillId: z.string().cuid(),
});

const userSkillContentInput = z.object({
  content: z.string().min(1).max(USER_SKILL_MAX_CHARS),
  filename: z.string().trim().max(240).optional(),
});

const updateUserSkillInput = userSkillIdInput.extend({
  content: z.string().min(1).max(USER_SKILL_MAX_CHARS),
});

const setUserSkillEnabledInput = userSkillIdInput.extend({
  enabled: z.boolean(),
});

const conversationListInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const conversationIdInput = z.object({
  conversationId: z.string().cuid(),
});

const sendMessageInput = z.object({
  conversationId: z.string().cuid().optional(),
  skillId: z.string().trim().min(1).optional(),
  skillIds: z
    .array(z.string().trim().min(1))
    .max(3, MAX_SELECTED_SKILLS_MESSAGE)
    .optional(),
  prompt: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  context: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  routingHint: z.enum(["SCHEDULED_TASK_SETUP"]).optional(),
});

const RESERVED_SKILLS = new Set([
  "scheduled-task-setup",
  "scheduled-task-edit",
  "scheduled-task-execution",
]);

function assertSkillsExist(
  selectedSkillIds: string[],
  skills: Awaited<ReturnType<AgentRuntimeClient["listSkills"]>>,
) {
  const availableSkillIds = new Set(skills.items.map((item) => item.id));
  const missingSkillId = selectedSkillIds.find(
    (skillId) => !availableSkillIds.has(skillId),
  );

  if (missingSkillId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Skill 不存在: ${missingSkillId}`,
    });
  }
}

function toSkillListResponse(
  runtimeSkills: Awaited<ReturnType<AgentRuntimeClient["listSkills"]>>,
  userSkills: Awaited<ReturnType<UserSkillService["list"]>>,
) {
  return {
    diagnostics: runtimeSkills.diagnostics,
    items: [
      ...runtimeSkills.items,
      ...userSkills
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: "我的 Skill",
          type: "prompt" as const,
          permissions: ["prompt"],
          source: "user" as const,
          version: skill.version,
          versionId: skill.versionId,
          contentHash: skill.contentHash,
        })),
    ],
  };
}

export const agentRuntimeRouter = createTRPCRouter({
  listSkills: protectedProcedure.query(async ({ ctx }) => {
    try {
      const client = new AgentRuntimeClient();
      const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
      const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
      const queryService = new AgentRuntimeQueryService(
        workflowRepository,
        agentRuntimeRepository,
        client,
      );

      const [runtimeSkills, userSkills] = await Promise.all([
        queryService.listSkills(),
        new UserSkillService(ctx.db).list(ctx.session.user.id),
      ]);
      return toSkillListResponse(runtimeSkills, userSkills);
    } catch (error) {
      throw mapError(error);
    }
  }),

  listMySkills: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await new UserSkillService(ctx.db).list(ctx.session.user.id);
    } catch (error) {
      throw mapError(error);
    }
  }),

  createSkill: protectedProcedure
    .input(userSkillContentInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new UserSkillService(ctx.db).create({
          userId: ctx.session.user.id,
          content: input.content,
          filename: input.filename,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  updateSkill: protectedProcedure
    .input(updateUserSkillInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new UserSkillService(ctx.db).update({
          userId: ctx.session.user.id,
          skillId: input.skillId,
          content: input.content,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  setSkillEnabled: protectedProcedure
    .input(setUserSkillEnabledInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new UserSkillService(ctx.db).setEnabled({
          userId: ctx.session.user.id,
          skillId: input.skillId,
          enabled: input.enabled,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  deleteSkill: protectedProcedure
    .input(userSkillIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await new UserSkillService(ctx.db).archive({
          userId: ctx.session.user.id,
          skillId: input.skillId,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  listConversations: protectedProcedure
    .input(conversationListInput)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaAgentConversationRepository(ctx.db);
        return await repository.listConversations({
          userId: ctx.session.user.id,
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  getConversation: protectedProcedure
    .input(conversationIdInput)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaAgentConversationRepository(ctx.db);
        const conversation = await repository.getConversation(
          ctx.session.user.id,
          input.conversationId,
        );

        if (!conversation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pi agent 对话不存在",
          });
        }

        return conversation;
      } catch (error) {
        throw mapError(error);
      }
    }),

  sendMessage: protectedProcedure
    .input(sendMessageInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const conversation = input.conversationId
          ? await ctx.db.agentConversation.findFirst({
              where: { id: input.conversationId, userId: ctx.session.user.id },
              select: { routingMode: true },
            })
          : null;
        const routeToEdit = conversation?.routingMode === "SCHEDULED_TASK_EDIT";
        const routeToSetup =
          !routeToEdit &&
          (input.routingHint === "SCHEDULED_TASK_SETUP" ||
            conversation?.routingMode === "SCHEDULED_TASK_SETUP" ||
            (await new ScheduledTaskIntentRouter().shouldEnterSetup(
              input.prompt,
            )));
        const requestedIds = [
          ...(input.skillIds ?? []),
          ...(input.skillId ? [input.skillId] : []),
        ];
        if (
          !routeToSetup &&
          !routeToEdit &&
          requestedIds.some((skillId) => RESERVED_SKILLS.has(skillId))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "系统保留 Skill 不能手动选择",
          });
        }
        const selectedSkills = routeToEdit
          ? {
              skillId: "scheduled-task-edit",
              skillIds: ["scheduled-task-edit"],
            }
          : routeToSetup
            ? {
                skillId: "scheduled-task-setup",
                skillIds: ["scheduled-task-setup"],
              }
            : normalizeSelectedSkillIds({
                skillId: input.skillId,
                skillIds: input.skillIds,
              });
        const agentRuntimeClient = new AgentRuntimeClient();
        const userSkillService = new UserSkillService(ctx.db);
        const userSkillDefinitions =
          !routeToSetup && !routeToEdit
            ? await userSkillService.resolveRuntimeDefinitions(
                ctx.session.user.id,
                selectedSkills.skillIds,
              )
            : [];
        if (!routeToSetup && !routeToEdit) {
          const [runtimeSkills, userSkills] = await Promise.all([
            agentRuntimeClient.listSkills(),
            userSkillService.list(ctx.session.user.id),
          ]);
          const skills = toSkillListResponse(runtimeSkills, userSkills);
          assertSkillsExist(selectedSkills.skillIds, skills);
        }

        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const conversationRepository = new PrismaAgentConversationRepository(
          ctx.db,
        );
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const service = new AgentConversationService(
          conversationRepository,
          workflowCommandService,
        );

        return await service.sendMessage({
          userId: ctx.session.user.id,
          conversationId: input.conversationId,
          skillId: selectedSkills.skillId,
          skillIds: selectedSkills.skillIds,
          prompt: input.prompt,
          title: input.title,
          context: input.context,
          userSkillDefinitions,
          routingMode: routeToEdit
            ? "SCHEDULED_TASK_EDIT"
            : routeToSetup
              ? "SCHEDULED_TASK_SETUP"
              : "AUTO",
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  startRun: protectedProcedure
    .input(startRunInput)
    .mutation(async ({ ctx, input }) => {
      try {
        if (
          [
            ...(input.skillIds ?? []),
            ...(input.skillId ? [input.skillId] : []),
          ].some((skillId) => RESERVED_SKILLS.has(skillId))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "系统保留 Skill 不能手动选择",
          });
        }
        const selectedSkills = normalizeSelectedSkillIds({
          skillId: input.skillId,
          skillIds: input.skillIds,
        });
        const agentRuntimeClient = new AgentRuntimeClient();
        const userSkillService = new UserSkillService(ctx.db);
        const [runtimeSkills, userSkills] = await Promise.all([
          agentRuntimeClient.listSkills(),
          userSkillService.list(ctx.session.user.id),
        ]);
        const skills = toSkillListResponse(runtimeSkills, userSkills);
        assertSkillsExist(selectedSkills.skillIds, skills);
        const userSkillDefinitions =
          await userSkillService.resolveRuntimeDefinitions(
            ctx.session.user.id,
            selectedSkills.skillIds,
          );

        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const commandService = new AgentRuntimeCommandService(
          workflowCommandService,
        );

        return await commandService.startRun({
          userId: ctx.session.user.id,
          skillId: selectedSkills.skillId,
          skillIds: selectedSkills.skillIds,
          prompt: input.prompt,
          title: input.title,
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
          context: input.context,
          userSkillDefinitions,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  listRuns: protectedProcedure
    .input(listRunsInput)
    .query(async ({ ctx, input }) => {
      try {
        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
        const queryService = new AgentRuntimeQueryService(
          workflowRepository,
          agentRuntimeRepository,
          new AgentRuntimeClient(),
        );

        return await queryService.listRuns({
          userId: ctx.session.user.id,
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  getRun: protectedProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    try {
      const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
      const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
      const queryService = new AgentRuntimeQueryService(
        workflowRepository,
        agentRuntimeRepository,
        new AgentRuntimeClient(),
      );
      const run = await queryService.getRun(ctx.session.user.id, input.runId);

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pi agent 运行不存在",
        });
      }

      return run;
    } catch (error) {
      throw mapError(error);
    }
  }),

  cancelRun: protectedProcedure
    .input(runIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const commandService = new AgentRuntimeCommandService(
          workflowCommandService,
        );

        const result = await commandService.cancelRun(
          ctx.session.user.id,
          input.runId,
        );

        const runtimeStore = new RedisWorkflowRuntimeStore();
        await Promise.race([
          runtimeStore.publishCancellation({
            runId: input.runId,
            reason: "user_requested",
            requestedAt: new Date().toISOString(),
          }),
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]).catch(() => undefined);
        await new PrismaAgentConversationRepository(
          ctx.db,
        ).markAssistantCancelledByRun(input.runId, "用户已请求取消");
        void new AgentRuntimeClient()
          .cancelRun(input.runId)
          .catch(() => undefined);
        return result;
      } catch (error) {
        throw mapError(error);
      }
    }),
});

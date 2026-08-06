import { z } from "zod";
import { ScheduledTaskDraftController } from "./scheduled-task-draft-controller";

const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    scoreDelta: z.number().finite(),
    condition: z.unknown(),
  })
  .strict();

const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_RULE"), rule: ruleSchema }).strict(),
  z
    .object({
      type: z.literal("UPDATE_RULE"),
      ruleId: z.string(),
      rule: ruleSchema,
    })
    .strict(),
  z.object({ type: z.literal("REMOVE_RULE"), ruleId: z.string() }).strict(),
  z
    .object({
      type: z.literal("SET_UNIVERSE"),
      universe: z.discriminatedUnion("type", [
        z.object({
          type: z.literal("stocks"),
          stockInputs: z.array(z.string()),
        }),
        z.object({ type: z.literal("all_a_shares") }),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("SET_SCHEDULE"), schedule: z.unknown() }).strict(),
  z
    .object({
      type: z.literal("SET_SELECTION"),
      selection: z.object({
        minScore: z.number().finite(),
        limit: z.number().int().min(1).max(5000),
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_INDICATOR_PARAMS"),
      indicatorParams: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_ADJUSTMENT"),
      adjustment: z.enum(["qfq", "hfq", "none"]),
    })
    .strict(),
]);

export const scoringTaskAgentChangeSetSchema = z
  .object({
    schemaVersion: z.literal("scoring-task-agent-changes.v2"),
    generatedAtVersion: z.number().int().positive(),
    ambiguity: z.discriminatedUnion("status", [
      z.object({ status: z.literal("CLEAR") }).strict(),
      z
        .object({
          status: z.literal("NEEDS_CLARIFICATION"),
          question: z.string().trim().min(1).max(500),
        })
        .strict(),
    ]),
    operations: z.array(operationSchema).min(1).max(100),
  })
  .strict();

type DraftRecord = Record<string, unknown> & { rules?: unknown[] };

export type AgentChangeMarker =
  | { type: "ADDED" | "MODIFIED" | "REMOVED"; ruleId: string }
  | { type: "MODIFIED"; field: string };

function applyOperations(
  source: unknown,
  operations: z.infer<typeof operationSchema>[],
) {
  const draft = structuredClone(source) as DraftRecord;
  const rules = Array.isArray(draft.rules) ? [...draft.rules] : [];
  const markers: AgentChangeMarker[] = [];
  for (const operation of operations) {
    switch (operation.type) {
      case "ADD_RULE":
        rules.push(operation.rule);
        markers.push({ type: "ADDED", ruleId: operation.rule.id });
        break;
      case "UPDATE_RULE": {
        const index = rules.findIndex(
          (rule) =>
            rule &&
            typeof rule === "object" &&
            "id" in rule &&
            rule.id === operation.ruleId,
        );
        if (index < 0) throw new Error("AGENT_RULE_NOT_FOUND");
        rules[index] = operation.rule;
        markers.push({ type: "MODIFIED", ruleId: operation.ruleId });
        break;
      }
      case "REMOVE_RULE": {
        const index = rules.findIndex(
          (rule) =>
            rule &&
            typeof rule === "object" &&
            "id" in rule &&
            rule.id === operation.ruleId,
        );
        if (index < 0) throw new Error("AGENT_RULE_NOT_FOUND");
        rules.splice(index, 1);
        markers.push({ type: "REMOVED", ruleId: operation.ruleId });
        break;
      }
      case "SET_UNIVERSE":
        draft.universe = operation.universe;
        markers.push({ type: "MODIFIED", field: "universe" });
        break;
      case "SET_SCHEDULE":
        draft.schedule = operation.schedule;
        markers.push({ type: "MODIFIED", field: "schedule" });
        break;
      case "SET_SELECTION":
        draft.selection = operation.selection;
        markers.push({ type: "MODIFIED", field: "selection" });
        break;
      case "SET_INDICATOR_PARAMS":
        draft.indicatorParams = operation.indicatorParams;
        markers.push({ type: "MODIFIED", field: "indicatorParams" });
        break;
      case "SET_ADJUSTMENT":
        draft.data = { adjustment: operation.adjustment };
        markers.push({ type: "MODIFIED", field: "data.adjustment" });
        break;
    }
  }
  draft.rules = rules;
  return { draft, markers };
}

export class ScheduledTaskAgentChangeController {
  private readonly drafts = new ScheduledTaskDraftController();

  apply(params: {
    generatedDraft: unknown;
    currentDraft: unknown;
    currentVersion: number;
    changeSet: unknown;
    conflictChoice?: "OVERWRITE_DRAFT" | "DISCARD_AGENT_CHANGES";
  }) {
    const parsed = scoringTaskAgentChangeSetSchema.safeParse(params.changeSet);
    if (!parsed.success)
      return { status: "REJECTED" as const, issues: ["Agent 变更集契约无效"] };
    if (parsed.data.ambiguity.status === "NEEDS_CLARIFICATION")
      return {
        status: "NEEDS_CLARIFICATION" as const,
        question: parsed.data.ambiguity.question,
      };
    if (parsed.data.generatedAtVersion !== params.currentVersion) {
      if (params.conflictChoice === "DISCARD_AGENT_CHANGES")
        return { status: "DISCARDED" as const };
      if (params.conflictChoice !== "OVERWRITE_DRAFT")
        return {
          status: "VERSION_CONFLICT" as const,
          generatedAtVersion: parsed.data.generatedAtVersion,
          currentVersion: params.currentVersion,
          choices: ["OVERWRITE_DRAFT", "DISCARD_AGENT_CHANGES"] as const,
        };
    }
    try {
      const applied = applyOperations(
        parsed.data.generatedAtVersion === params.currentVersion
          ? params.currentDraft
          : params.generatedDraft,
        parsed.data.operations,
      );
      const validation = this.drafts.validate(applied.draft);
      if (!validation.valid)
        return {
          status: "REJECTED" as const,
          issues: validation.issues.map(
            (item) => `${item.path}: ${item.message}`,
          ),
        };
      return {
        status: "APPLIED" as const,
        draft: validation.draft,
        markers: applied.markers,
      };
    } catch {
      return { status: "REJECTED" as const, issues: ["Agent 变更无法应用"] };
    }
  }
}

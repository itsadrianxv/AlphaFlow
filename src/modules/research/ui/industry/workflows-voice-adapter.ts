import type {
  ResearchVoiceContext,
  ResearchVoiceFieldPatch,
} from "~/modules/research/contracts/voice";

export type WorkflowsVoiceFormState = {
  query: string;
  researchGoal: string;
  mustAnswerQuestions: string;
  forbiddenEvidenceTypes: string;
  preferredSources: string;
  freshnessWindowDays: string;
  deepMode: boolean;
  idempotencyKey: string;
};

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinLines(items: string[] | undefined) {
  return (items ?? []).join("\n");
}

function parseOptionalNumber(value: string) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildWorkflowsVoiceContext(
  state: WorkflowsVoiceFormState,
  quickPrompts: string[],
): ResearchVoiceContext {
  return {
    pageKind: "quick_research",
    currentFields: {
      query: state.query.trim() || undefined,
      researchGoal: state.researchGoal.trim() || undefined,
      mustAnswerQuestions: splitLines(state.mustAnswerQuestions),
      preferredSources: splitLines(state.preferredSources),
      freshnessWindowDays: parseOptionalNumber(state.freshnessWindowDays),
    },
    starterExamples: quickPrompts,
  };
}

export function applyWorkflowsVoicePatch(
  state: WorkflowsVoiceFormState,
  patch: ResearchVoiceFieldPatch,
): WorkflowsVoiceFormState {
  return {
    query: patch.query ?? state.query,
    researchGoal: patch.researchGoal ?? state.researchGoal,
    mustAnswerQuestions:
      patch.mustAnswerQuestions !== undefined
        ? joinLines(patch.mustAnswerQuestions)
        : state.mustAnswerQuestions,
    forbiddenEvidenceTypes: state.forbiddenEvidenceTypes,
    preferredSources:
      patch.preferredSources !== undefined
        ? joinLines(patch.preferredSources)
        : state.preferredSources,
    freshnessWindowDays:
      patch.freshnessWindowDays !== undefined
        ? String(patch.freshnessWindowDays)
        : state.freshnessWindowDays,
    deepMode: state.deepMode,
    idempotencyKey: state.idempotencyKey,
  };
}

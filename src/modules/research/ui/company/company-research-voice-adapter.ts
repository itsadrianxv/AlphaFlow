import type {
  ResearchVoiceContext,
  ResearchVoiceFieldPatch,
} from "~/modules/research/contracts/voice";

export type CompanyResearchVoiceFormState = {
  companyName: string;
  stockCode: string;
  officialWebsite: string;
  focusConcepts: string;
  keyQuestion: string;
  supplementalUrls: string;
  idempotencyKey: string;
  researchGoal: string;
  mustAnswerQuestions: string;
  forbiddenEvidenceTypes: string;
  preferredSources: string;
  freshnessWindowDays: string;
};

function splitItems(value: string) {
  return value
    .split(/[\n,，]/)
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

export function buildCompanyResearchVoiceContext(
  state: CompanyResearchVoiceFormState,
  starterExamples: string[],
): ResearchVoiceContext {
  return {
    pageKind: "company_research",
    currentFields: {
      companyName: state.companyName.trim() || undefined,
      stockCode: state.stockCode.trim() || undefined,
      keyQuestion: state.keyQuestion.trim() || undefined,
      focusConcepts: splitItems(state.focusConcepts),
      researchGoal: state.researchGoal.trim() || undefined,
      mustAnswerQuestions: splitItems(state.mustAnswerQuestions),
      preferredSources: splitItems(state.preferredSources),
      freshnessWindowDays: parseOptionalNumber(state.freshnessWindowDays),
    },
    starterExamples,
  };
}

export function applyCompanyResearchVoicePatch(
  state: CompanyResearchVoiceFormState,
  patch: ResearchVoiceFieldPatch,
): CompanyResearchVoiceFormState {
  return {
    companyName: patch.companyName ?? state.companyName,
    stockCode: patch.stockCode ?? state.stockCode,
    officialWebsite: state.officialWebsite,
    focusConcepts:
      patch.focusConcepts !== undefined
        ? joinLines(patch.focusConcepts)
        : state.focusConcepts,
    keyQuestion: patch.keyQuestion ?? state.keyQuestion,
    supplementalUrls: state.supplementalUrls,
    idempotencyKey: state.idempotencyKey,
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
  };
}

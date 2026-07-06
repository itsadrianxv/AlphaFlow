import { buildIndustryResearchTaskContract } from "~/server/domain/workflow/research";

type IndustryResearchFormInput = {
  query: string;
  idempotencyKey: string;
  researchGoal: string;
  mustAnswerQuestions: string;
  forbiddenEvidenceTypes: string;
  preferredSources: string;
  freshnessWindowDays: string;
  deepMode: boolean;
};

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildIndustryResearchStartInput(input: IndustryResearchFormInput) {
  return {
    query: input.query.trim(),
    taskContract: input.deepMode
      ? buildIndustryResearchTaskContract("deep")
      : undefined,
    researchPreferences:
      input.researchGoal.trim() ||
      input.mustAnswerQuestions.trim() ||
      input.forbiddenEvidenceTypes.trim() ||
      input.preferredSources.trim() ||
      input.freshnessWindowDays.trim()
        ? {
            researchGoal: input.researchGoal.trim() || undefined,
            mustAnswerQuestions: splitLines(input.mustAnswerQuestions),
            forbiddenEvidenceTypes: splitLines(input.forbiddenEvidenceTypes),
            preferredSources: splitLines(input.preferredSources),
            freshnessWindowDays:
              Number.parseInt(input.freshnessWindowDays.trim(), 10) ||
              undefined,
          }
        : undefined,
    idempotencyKey: input.idempotencyKey.trim() || undefined,
  };
}

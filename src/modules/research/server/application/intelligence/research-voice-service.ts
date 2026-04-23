import { z } from "zod";
import type {
  ResearchVoiceConfidenceLevel,
  ResearchVoiceContext,
  ResearchVoiceFieldPatch,
  ResearchVoiceIntakeResponse,
  ResearchVoicePageKind,
  VoiceTranscriptionResponse,
} from "~/modules/research/contracts/voice";
import { env } from "~/platform/env";

const normalizedPrimaryOutputSchema = z.object({
  normalizedPrimaryText: z.string().trim().min(1),
});

const stringSuggestionSchema = z.object({
  value: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

const stringListSuggestionSchema = z.object({
  value: z.array(z.string().trim().min(1)).max(8),
  confidence: z.number().min(0).max(1),
});

const freshnessSuggestionSchema = z.object({
  value: z.union([z.number().int().min(1).max(3650), z.string().trim().min(1)]),
  confidence: z.number().min(0).max(1),
});

const fieldSuggestionSchema = z.object({
  companyName: stringSuggestionSchema.optional(),
  stockCode: stringSuggestionSchema.optional(),
  focusConcepts: stringListSuggestionSchema.optional(),
  researchGoal: stringSuggestionSchema.optional(),
  mustAnswerQuestions: stringListSuggestionSchema.optional(),
  preferredSources: stringListSuggestionSchema.optional(),
  freshnessWindowDays: freshnessSuggestionSchema.optional(),
});

export type ResearchVoiceUpload = {
  audioBytes: Uint8Array;
  fileName: string;
  mimeType: string;
  context: ResearchVoiceContext;
};

export type PythonVoiceTranscriptionClientLike = {
  transcribe(params: {
    audioBytes: Uint8Array;
    fileName: string;
    mimeType: string;
    pageKind: ResearchVoicePageKind;
    dynamicHotwords: ResearchVoiceContext["currentFields"];
    starterExamples: string[];
  }): Promise<VoiceTranscriptionResponse>;
};

export type DeepSeekVoiceClientLike = {
  isConfigured(): boolean;
  completeContract<T>(
    messages: Array<{ role: "system" | "user"; content: string }>,
    fallbackValue: T,
    schema: z.ZodType<T>,
    options?: {
      maxStructuredOutputRetries?: number;
    },
  ): Promise<T>;
};

export type LocalStockSearchServiceLike = {
  search(
    keyword: string,
    limit: number,
  ): Promise<
    Array<{
      stockCode: string;
      stockName: string;
      matchField: "CODE" | "NAME";
    }>
  >;
};

export type ResearchVoiceServiceDependencies = {
  pythonVoiceTranscriptionClient: PythonVoiceTranscriptionClientLike;
  deepSeekClient: DeepSeekVoiceClientLike;
  localStockSearchService: LocalStockSearchServiceLike;
};

function compactTranscriptWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getConfidenceLevel(
  overallConfidence: number,
): ResearchVoiceConfidenceLevel {
  if (overallConfidence < env.VOICE_PRIMARY_ONLY_CONFIDENCE) {
    return "low";
  }

  if (overallConfidence < env.VOICE_FIELD_AUTOFILL_CONFIDENCE) {
    return "medium";
  }

  return "high";
}

function getPrimaryFieldKey(pageKind: ResearchVoicePageKind) {
  return pageKind === "quick_research" ? "query" : "keyQuestion";
}

function dedupeStringList(items: string[] | undefined) {
  return [...new Set((items ?? []).map((item) => item.trim()).filter(Boolean))];
}

function normalizeFreshnessWindow(value: number | string | undefined) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.round(value);
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  const explicitNumber = normalized.match(/(\d{1,4})/);
  if (explicitNumber) {
    return Number.parseInt(explicitNumber[1] ?? "", 10);
  }

  const mapping = new Map<string, number>([
    ["最近一周", 7],
    ["最近一个月", 30],
    ["最近三个月", 90],
    ["一个季度", 90],
    ["最近半年", 180],
    ["最近一年", 365],
  ]);

  return mapping.get(normalized);
}

export class ResearchVoiceService {
  private readonly pythonVoiceTranscriptionClient: PythonVoiceTranscriptionClientLike;
  private readonly deepSeekClient: DeepSeekVoiceClientLike;
  private readonly localStockSearchService: LocalStockSearchServiceLike;

  constructor(dependencies: ResearchVoiceServiceDependencies) {
    this.pythonVoiceTranscriptionClient =
      dependencies.pythonVoiceTranscriptionClient;
    this.deepSeekClient = dependencies.deepSeekClient;
    this.localStockSearchService = dependencies.localStockSearchService;
  }

  async processResearchVoice(
    input: ResearchVoiceUpload,
  ): Promise<ResearchVoiceIntakeResponse> {
    const transcription = await this.transcribeAudio(input);
    const fallbackPrimaryText = compactTranscriptWhitespace(
      transcription.transcript,
    );
    const primaryFieldKey = getPrimaryFieldKey(input.context.pageKind);
    const confidenceLevel = getConfidenceLevel(transcription.overallConfidence);

    if (!this.deepSeekClient.isConfigured()) {
      return this.buildPrimaryOnlyResponse({
        fallbackPrimaryText,
        primaryFieldKey,
        transcription,
        confidenceLevel,
      });
    }

    try {
      const normalizedPrimaryText = await this.normalizeTranscript(
        transcription.transcript,
        input.context,
      );

      if (confidenceLevel !== "high") {
        return this.buildPrimaryOnlyResponse({
          fallbackPrimaryText: normalizedPrimaryText,
          primaryFieldKey,
          transcription,
          confidenceLevel,
        });
      }

      const suggestions = await this.buildFieldSuggestions(
        transcription.transcript,
        normalizedPrimaryText,
        input.context,
      );
      const appliedPatch = await this.buildFieldPatch({
        normalizedPrimaryText,
        primaryFieldKey,
        pageKind: input.context.pageKind,
        suggestions,
      });

      return {
        normalizedPrimaryText,
        appliedPatch,
        appliedFieldKeys: Object.keys(appliedPatch) as Array<
          keyof ResearchVoiceFieldPatch
        >,
        confidenceLevel,
        degradedToPrimaryOnly: false,
        source: {
          durationMs: transcription.durationMs,
          overallConfidence: transcription.overallConfidence,
        },
      };
    } catch {
      return this.buildPrimaryOnlyResponse({
        fallbackPrimaryText,
        primaryFieldKey,
        transcription,
        confidenceLevel,
      });
    }
  }

  private async transcribeAudio(input: ResearchVoiceUpload) {
    return this.pythonVoiceTranscriptionClient.transcribe({
      audioBytes: input.audioBytes,
      fileName: input.fileName,
      mimeType: input.mimeType,
      pageKind: input.context.pageKind,
      dynamicHotwords: input.context.currentFields,
      starterExamples: input.context.starterExamples,
    });
  }

  private async normalizeTranscript(
    transcript: string,
    context: ResearchVoiceContext,
  ) {
    const fallbackValue = {
      normalizedPrimaryText: compactTranscriptWhitespace(transcript),
    };
    const result = await this.deepSeekClient.completeContract(
      [
        {
          role: "system",
          content:
            "You clean spoken Chinese investment research questions. Remove filler words and obvious ASR punctuation noise, but never add facts, fields, or semantic expansion.",
        },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            pageKind: context.pageKind,
            currentFields: context.currentFields,
          }),
        },
      ],
      fallbackValue,
      normalizedPrimaryOutputSchema,
      { maxStructuredOutputRetries: 1 },
    );

    return compactTranscriptWhitespace(result.normalizedPrimaryText);
  }

  private async buildFieldSuggestions(
    transcript: string,
    normalizedPrimaryText: string,
    context: ResearchVoiceContext,
  ) {
    return this.deepSeekClient.completeContract(
      [
        {
          role: "system",
          content:
            "You map a cleaned Chinese research question into optional whitelisted form fields only. Do not rewrite the primary question and do not infer non-whitelisted fields.",
        },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            normalizedPrimaryText,
            pageKind: context.pageKind,
            currentFields: context.currentFields,
            starterExamples: context.starterExamples,
          }),
        },
      ],
      {},
      fieldSuggestionSchema,
      { maxStructuredOutputRetries: 1 },
    );
  }

  private async buildFieldPatch(params: {
    normalizedPrimaryText: string;
    primaryFieldKey: "query" | "keyQuestion";
    pageKind: ResearchVoicePageKind;
    suggestions: z.infer<typeof fieldSuggestionSchema>;
  }): Promise<ResearchVoiceFieldPatch> {
    const patch: ResearchVoiceFieldPatch = {
      [params.primaryFieldKey]: params.normalizedPrimaryText,
    };

    if (
      params.suggestions.researchGoal &&
      params.suggestions.researchGoal.confidence >=
        env.VOICE_FIELD_AUTOFILL_CONFIDENCE
    ) {
      patch.researchGoal = params.suggestions.researchGoal.value;
    }

    if (
      params.suggestions.mustAnswerQuestions &&
      params.suggestions.mustAnswerQuestions.confidence >=
        env.VOICE_FIELD_AUTOFILL_CONFIDENCE
    ) {
      patch.mustAnswerQuestions = dedupeStringList(
        params.suggestions.mustAnswerQuestions.value,
      );
    }

    if (
      params.suggestions.preferredSources &&
      params.suggestions.preferredSources.confidence >=
        env.VOICE_FIELD_AUTOFILL_CONFIDENCE
    ) {
      patch.preferredSources = dedupeStringList(
        params.suggestions.preferredSources.value,
      );
    }

    if (
      params.suggestions.freshnessWindowDays &&
      params.suggestions.freshnessWindowDays.confidence >=
        env.VOICE_FIELD_AUTOFILL_CONFIDENCE
    ) {
      const normalizedFreshness = normalizeFreshnessWindow(
        params.suggestions.freshnessWindowDays.value,
      );

      if (normalizedFreshness !== undefined) {
        patch.freshnessWindowDays = normalizedFreshness;
      }
    }

    if (params.pageKind === "company_research") {
      if (
        params.suggestions.focusConcepts &&
        params.suggestions.focusConcepts.confidence >=
          env.VOICE_FIELD_AUTOFILL_CONFIDENCE
      ) {
        patch.focusConcepts = dedupeStringList(
          params.suggestions.focusConcepts.value,
        );
      }

      await this.applyCompanyPatch(params.suggestions, patch);
    }

    return patch;
  }

  private async applyCompanyPatch(
    suggestions: z.infer<typeof fieldSuggestionSchema>,
    patch: ResearchVoiceFieldPatch,
  ) {
    if (
      !suggestions.companyName ||
      suggestions.companyName.confidence < env.VOICE_COMPANY_AUTOFILL_CONFIDENCE
    ) {
      return;
    }

    const companyName = suggestions.companyName.value.trim();
    const results = await this.localStockSearchService.search(companyName, 5);
    const exactMatches = results.filter(
      (item) =>
        item.matchField === "NAME" &&
        item.stockName.trim().toLowerCase() === companyName.toLowerCase(),
    );

    if (exactMatches.length !== 1) {
      return;
    }

    const exactMatch = exactMatches[0];
    if (!exactMatch) {
      return;
    }
    const suggestedStockCode = suggestions.stockCode?.value?.trim();
    if (
      suggestedStockCode &&
      (!/^\d{6}$/.test(suggestedStockCode) ||
        suggestedStockCode !== exactMatch.stockCode)
    ) {
      return;
    }

    patch.companyName = exactMatch.stockName;
    if (/^\d{6}$/.test(exactMatch.stockCode)) {
      patch.stockCode = exactMatch.stockCode;
    }
  }

  private buildPrimaryOnlyResponse(params: {
    fallbackPrimaryText: string;
    primaryFieldKey: "query" | "keyQuestion";
    transcription: VoiceTranscriptionResponse;
    confidenceLevel: ResearchVoiceConfidenceLevel;
  }): ResearchVoiceIntakeResponse {
    const appliedPatch = {
      [params.primaryFieldKey]: params.fallbackPrimaryText,
    } as ResearchVoiceFieldPatch;

    return {
      normalizedPrimaryText: params.fallbackPrimaryText,
      appliedPatch,
      appliedFieldKeys: [params.primaryFieldKey],
      confidenceLevel: params.confidenceLevel,
      degradedToPrimaryOnly: true,
      source: {
        durationMs: params.transcription.durationMs,
        overallConfidence: params.transcription.overallConfidence,
      },
    };
  }
}

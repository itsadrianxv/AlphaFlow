import { z } from "zod";
import {
  customFormulaSpecSchema,
  indicatorCatalogItemSchema,
  indicatorCategorySchema,
  workspaceQuerySchema,
  workspaceResultSchema,
} from "~/contracts/screening";
import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

const capabilityMetaSchema = z.object({
  traceId: z.string(),
  provider: z.string(),
  capability: z.string(),
  operation: z.string(),
  retryable: z.boolean().optional().default(false),
  failurePhase: z.string().nullable().optional(),
  diagnostics: z.record(z.unknown()).optional().default({}),
});

const capabilityResponseSchema = z.object({
  meta: capabilityMetaSchema,
  data: z.unknown(),
});

const capabilityErrorSchema = z.object({
  error: z.object({
    traceId: z.string(),
    provider: z.string(),
    capability: z.string(),
    operation: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional().default(false),
    failurePhase: z.string(),
    diagnostics: z.record(z.unknown()).optional().default({}),
  }),
});

const screeningCatalogResponseSchema = z.object({
  items: z.array(indicatorCatalogItemSchema),
  categories: z.array(indicatorCategorySchema),
});

const formulaValidationResponseSchema = z.object({
  valid: z.boolean(),
  normalizedExpression: z.string().nullable().optional(),
  referencedMetrics: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
});

const screeningQueryRequestSchema = z.object({
  stockCodes: workspaceQuerySchema.shape.stockCodes,
  indicators: z.array(indicatorCatalogItemSchema),
  formulas: z.array(customFormulaSpecSchema),
  timeConfig: workspaceQuerySchema.shape.timeConfig,
});

const capabilityWebSearchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  markdown: z.string().optional(),
});

const capabilityWebDocumentSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  markdown: z.string().optional(),
});

const DEFAULT_SCREENING_TIMEOUT_MS = 60_000;
const DEFAULT_INTELLIGENCE_TIMEOUT_MS = 300_000;

type CapabilityResponse = z.infer<typeof capabilityResponseSchema>;
type ScreeningQueryRequest = z.infer<typeof screeningQueryRequestSchema>;

type WebSearchRequest = {
  queries: string[];
  limit?: number;
};

type WebFetchRequest = {
  url: string;
};

type ConceptMatchRequest = {
  theme: string;
  limit?: number;
};

export type PythonCapabilityGatewayClientConfig = {
  baseUrl?: string;
  screeningTimeoutMs?: number;
  intelligenceTimeoutMs?: number;
};

export type CapabilityWebSearchResult = z.infer<
  typeof capabilityWebSearchResultSchema
>;
export type CapabilityWebDocument = z.infer<typeof capabilityWebDocumentSchema>;

function resolveTimeoutMs(value: number | undefined, fallback: number) {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? value
    : fallback;
}

function resolveCapabilityServiceBaseUrl(rawBaseUrl: string) {
  const normalized = rawBaseUrl.replace(/\/$/, "");
  if (normalized.endsWith("/api/v1")) {
    return normalized.replace(/\/v1$/, "");
  }
  if (normalized.endsWith("/api")) {
    return normalized.replace(/\/api$/, "");
  }
  return normalized;
}

export class PythonCapabilityGatewayClient {
  private readonly baseUrl: string;
  private readonly screeningTimeoutMs: number;
  private readonly intelligenceTimeoutMs: number;

  constructor(config?: PythonCapabilityGatewayClientConfig) {
    this.baseUrl = resolveCapabilityServiceBaseUrl(
      config?.baseUrl ?? env.PYTHON_SERVICE_URL,
    );
    this.screeningTimeoutMs = resolveTimeoutMs(
      config?.screeningTimeoutMs ?? env.PYTHON_SERVICE_TIMEOUT_MS,
      DEFAULT_SCREENING_TIMEOUT_MS,
    );
    this.intelligenceTimeoutMs = resolveTimeoutMs(
      config?.intelligenceTimeoutMs ??
        env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS,
      DEFAULT_INTELLIGENCE_TIMEOUT_MS,
    );
  }

  isConfigured() {
    return true;
  }

  async listIndicatorCatalog() {
    const [items, categories] = await Promise.all([
      this.requestJson(
        "/api/v1/screening/indicators",
        undefined,
        z.array(indicatorCatalogItemSchema),
        this.screeningTimeoutMs,
      ),
      this.requestJson(
        "/api/v1/screening/indicator-categories",
        undefined,
        z.array(indicatorCategorySchema),
        this.screeningTimeoutMs,
      ),
    ]);

    return screeningCatalogResponseSchema.parse({ items, categories });
  }

  async validateFormula(params: {
    expression: string;
    targetIndicators: string[];
  }) {
    return this.requestJson(
      "/api/v1/screening/formulas/validate",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
      formulaValidationResponseSchema,
      this.screeningTimeoutMs,
    );
  }

  async queryDataset(input: ScreeningQueryRequest) {
    return workspaceResultSchema.parse(await this.queryScreeningDataset(input));
  }

  async queryScreeningDataset(input: ScreeningQueryRequest) {
    const payload = screeningQueryRequestSchema.parse(input);
    const response = await this.request(
      "/api/v1/capabilities/screening/query-dataset",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      this.screeningTimeoutMs,
    );
    return response.data as Record<string, unknown>;
  }

  async search(params: { query: string; limit?: number }) {
    return capabilityWebSearchResultSchema
      .array()
      .parse(
        await this.searchWeb({ queries: [params.query], limit: params.limit }),
      );
  }

  async searchWeb(input: WebSearchRequest) {
    const response = await this.request(
      "/api/v1/capabilities/web/search",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.intelligenceTimeoutMs,
    );
    return response.data as Array<Record<string, unknown>>;
  }

  async scrapeUrl(url: string) {
    const document = await this.fetchWeb({ url });
    return document ? capabilityWebDocumentSchema.parse(document) : null;
  }

  async fetchWeb(input: WebFetchRequest) {
    const response = await this.request(
      "/api/v1/capabilities/web/fetch",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.intelligenceTimeoutMs,
    );
    return response.data as Record<string, unknown> | null;
  }

  async matchConcepts(input: ConceptMatchRequest) {
    const response = await this.request(
      "/api/v1/capabilities/concepts/match",
      {
        method: "POST",
        body: JSON.stringify(input),
      },
      this.intelligenceTimeoutMs,
    );
    return response.data as Array<Record<string, unknown>>;
  }

  private async requestJson<T>(
    path: string,
    init: RequestInit | undefined,
    parser: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw this.asWorkflowError(errorText, response.status);
      }

      return parser.parse(await response.json());
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }
      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Capability gateway request timed out after ${timeoutMs}ms`,
        );
      }
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Capability gateway request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    path: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<CapabilityResponse> {
    const payload = await this.requestJson(
      path,
      init,
      capabilityResponseSchema,
      timeoutMs,
    );

    return {
      meta: {
        ...payload.meta,
        retryable: payload.meta.retryable ?? false,
        diagnostics: payload.meta.diagnostics ?? {},
      },
      data: payload.data,
    };
  }

  private asWorkflowError(errorText: string, status: number) {
    try {
      const payload = capabilityErrorSchema.parse(JSON.parse(errorText));
      const error = payload.error;
      const message = [
        error.message,
        `traceId=${error.traceId}`,
        `provider=${error.provider}`,
        `capability=${error.capability}`,
        `operation=${error.operation}`,
      ].join(" | ");
      return new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        message,
      );
    } catch {
      return new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Capability gateway error (${status}): ${errorText}`,
      );
    }
  }
}

import { z } from "zod";
import {
  customFormulaSpecSchema,
  indicatorCatalogItemSchema,
  indicatorCategorySchema,
  searchStockResultSchema,
  workspaceQuerySchema,
  workspaceResultSchema,
} from "~/modules/screening/contracts/screening";
import { DataNotAvailableError } from "~/modules/screening/server/domain/errors";
import { env } from "~/platform/env";

const DEFAULT_TIMEOUT_MS = 60_000;

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

type PythonScreeningCatalogResponse = z.infer<
  typeof screeningCatalogResponseSchema
>;
type FormulaValidationResponse = z.infer<
  typeof formulaValidationResponseSchema
>;
type ScreeningQueryRequest = z.infer<typeof screeningQueryRequestSchema>;

function normalizeBaseUrl(rawBaseUrl: string) {
  return rawBaseUrl.replace(/\/$/, "");
}

function extractPythonServiceErrorMessage(
  errorBody: string,
  response: Response,
): string {
  try {
    const parsed = JSON.parse(errorBody) as {
      detail?: unknown;
      message?: unknown;
    };

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }

    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    // Fall through to raw body handling.
  }

  if (errorBody.trim()) {
    return errorBody.trim();
  }

  return `Python screening service error: ${response.status} ${response.statusText}`;
}

export class PythonScreeningWorkbenchClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    baseUrl = env.PYTHON_SERVICE_URL,
    timeoutMs = env.PYTHON_SERVICE_TIMEOUT_MS,
  ) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  }

  private screeningPath(path: string) {
    return `${this.baseUrl}/api/v1/screening${path}`;
  }

  private async fetchJson<T>(
    path: string,
    options: RequestInit | undefined,
    parser: z.ZodType<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.screeningPath(path), {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new DataNotAvailableError(
          extractPythonServiceErrorMessage(errorBody, response),
          response.status,
          errorBody,
        );
      }

      const payload = (await response.json()) as unknown;
      return parser.parse(payload);
    } catch (error) {
      if (error instanceof DataNotAvailableError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new DataNotAvailableError(
          `Python screening service timed out after ${this.timeoutMs}ms`,
        );
      }

      throw new DataNotAvailableError(
        `Python screening service request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async searchStocks(keyword: string, limit: number) {
    const params = new URLSearchParams({
      keyword,
      limit: `${limit}`,
    });

    return this.fetchJson(
      `/stocks/search?${params.toString()}`,
      undefined,
      z.array(searchStockResultSchema),
    );
  }

  async listIndicatorCatalog(): Promise<PythonScreeningCatalogResponse> {
    const [items, categories] = await Promise.all([
      this.fetchJson(
        "/indicators",
        undefined,
        z.array(indicatorCatalogItemSchema),
      ),
      this.fetchJson(
        "/indicator-categories",
        undefined,
        z.array(indicatorCategorySchema),
      ),
    ]);

    return screeningCatalogResponseSchema.parse({ items, categories });
  }

  async validateFormula(params: {
    expression: string;
    targetIndicators: string[];
  }): Promise<FormulaValidationResponse> {
    const response = await this.fetchJson(
      "/formulas/validate",
      {
        method: "POST",
        body: JSON.stringify(params),
      },
      formulaValidationResponseSchema,
    );
    return formulaValidationResponseSchema.parse(response);
  }

  async queryDataset(input: ScreeningQueryRequest) {
    const payload = screeningQueryRequestSchema.parse(input);
    return this.fetchJson(
      "/query",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      workspaceResultSchema,
    );
  }
}

import { companyOverviewSchema } from "~/contracts/company-overview";
import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

export class PythonCompanyOverviewClient {
  async getOverview(stockCode: string) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      env.PYTHON_SERVICE_TIMEOUT_MS,
    );
    try {
      const response = await fetch(
        `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/company-overview/stocks/${stockCode}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const payload = (await response.json()) as { data?: unknown };
      return companyOverviewSchema.parse(payload.data);
    } catch (error) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `公司概况数据服务不可用: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

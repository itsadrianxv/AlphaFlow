import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "~/env";
import {
  type ScheduledTaskDraftInput,
  scheduledTaskDraftInputSchema,
  validateTuShareStockCode,
} from "~/server/domain/scheduled-task/contracts";
import {
  hasDeliveryTarget,
  listDeliveryTargets,
} from "~/server/domain/scheduled-task/delivery-targets";
import {
  computeNextRunAt,
  validateScheduleSpec,
} from "~/server/domain/scheduled-task/schedule";

type Capability = {
  id: string;
  provider: string;
  executionTool: string;
  dataset?: string;
  available: boolean;
  fields?: string[];
  allowedParameters?: string[];
  maxRows?: number;
  maxLookbackDays?: number;
  minimumCredits?: number;
  liveProbe: boolean;
  documentationUrl?: string;
};

const INTERNAL_CAPABILITIES: Capability[] = [
  {
    id: "internal_web_search",
    provider: "tavily",
    executionTool: "internal_web_search",
    available: true,
    liveProbe: false,
    maxRows: 10,
  },
  {
    id: "internal_web_fetch",
    provider: "web",
    executionTool: "internal_web_fetch",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_screening_query",
    provider: "alphaflow",
    executionTool: "internal_screening_query",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_stock_bars",
    provider: "tushare",
    executionTool: "internal_stock_bars",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_stock_daily_basic",
    provider: "tushare",
    executionTool: "internal_stock_daily_basic",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_moneyflow",
    provider: "tushare",
    executionTool: "internal_moneyflow",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_market_events",
    provider: "tushare",
    executionTool: "internal_market_events",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_shareholder_events",
    provider: "tushare",
    executionTool: "internal_shareholder_events",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_financial_statements",
    provider: "tushare",
    executionTool: "internal_financial_statements",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_financial_indicators",
    provider: "tushare",
    executionTool: "internal_financial_indicators",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_earnings_events",
    provider: "tushare",
    executionTool: "internal_earnings_events",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_fund_market",
    provider: "tushare",
    executionTool: "internal_fund_market",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_convertible_bond_market",
    provider: "tushare",
    executionTool: "internal_convertible_bond_market",
    available: true,
    liveProbe: false,
  },
  {
    id: "internal_macro_rates",
    provider: "tushare",
    executionTool: "internal_macro_rates",
    available: true,
    liveProbe: false,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function pythonJson(path: string, init?: RequestInit) {
  const response = await fetch(
    `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}${path}`,
    init,
  );
  if (!response.ok) throw new Error(`能力目录请求失败: ${response.status}`);
  return response.json() as Promise<unknown>;
}

export class ScheduledTaskSetupService {
  constructor(private readonly db: PrismaClient) {}

  async listCapabilities(filter?: { provider?: string; query?: string }) {
    const payload = asRecord(await pythonJson("/api/v1/capabilities/catalog"));
    const remote = Array.isArray(payload.items)
      ? payload.items.map((item) => asRecord(item) as Capability)
      : [];
    const query = filter?.query?.trim().toLowerCase();
    const items = [...INTERNAL_CAPABILITIES, ...remote].filter(
      (item) =>
        (!filter?.provider || item.provider === filter.provider) &&
        (!query ||
          item.id.toLowerCase().includes(query) ||
          item.provider.toLowerCase().includes(query)),
    );
    return {
      items,
      liveProbe: false,
      warnings: ["能力仅按目录和参数校验，未执行真实数据探测"],
    };
  }

  async inspectCapability(capability: string) {
    const local = INTERNAL_CAPABILITIES.find((item) => item.id === capability);
    if (local) return local;
    const response = await fetch(
      `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/capabilities/catalog/${encodeURIComponent(capability)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`能力详情请求失败: ${response.status}`);
    return response.json() as Promise<Capability>;
  }

  async resolveUserScope(userId: string) {
    const [watchlists, companies, industries] = await Promise.all([
      this.db.watchList.findMany({
        where: { userId },
        select: { id: true, name: true, stocks: true },
        orderBy: { updatedAt: "desc" },
        take: 50,
      }),
      this.db.savedCompany.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, stockCode: true, companyName: true },
        take: 50,
      }),
      this.db.savedIndustry.findMany({
        where: { userId, archivedAt: null },
        select: { id: true, name: true },
        take: 50,
      }),
    ]);
    return {
      timezone: "Asia/Shanghai",
      watchlists,
      companies,
      industries,
      deliveryTargets: listDeliveryTargets(),
    };
  }

  private async isTradingDay(date: string, market: string) {
    const tushareDate = date.replaceAll("-", "");
    const payload = asRecord(
      await pythonJson("/api/v1/capabilities/tushare/query-dataset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dataset: "trade_cal",
          params: {
            exchange: market,
            start_date: tushareDate,
            end_date: tushareDate,
          },
          maxRows: 5,
        }),
      }),
    );
    const rows = Array.isArray(payload.rows) ? payload.rows.map(asRecord) : [];
    return rows.some((row) => String(row.is_open) === "1");
  }

  async nextRunAt(
    schedule: ScheduledTaskDraftInput["schedule"],
    after = new Date(),
  ) {
    return computeNextRunAt(schedule, after, (date, market) =>
      this.isTradingDay(date, market),
    );
  }

  async validateDraft(value: unknown) {
    const parsed = scheduledTaskDraftInputSchema.safeParse(value);
    if (!parsed.success) {
      return {
        feasibility: {
          status: "NEEDS_CLARIFICATION",
          warnings: [],
          blockingIssues: parsed.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`,
          ),
        },
      };
    }
    const draft = parsed.data;
    const blockingIssues = validateScheduleSpec(draft.schedule);
    const warnings = ["能力仅按目录和参数校验，未执行真实数据探测"];
    const capabilities: Capability[] = [];
    for (const source of draft.dataSources) {
      const capability = await this.inspectCapability(source.capability);
      if (!capability)
        blockingIssues.push(`数据能力不存在: ${source.capability}`);
      else if (!capability.available)
        blockingIssues.push(`数据能力当前不可用: ${source.capability}`);
      else {
        const unknown = capability.allowedParameters
          ? Object.keys(source.parameters).filter(
              (key) => !capability.allowedParameters?.includes(key),
            )
          : [];
        if (unknown.length)
          blockingIssues.push(
            `${source.capability} 包含未允许参数: ${unknown.join(", ")}`,
          );
        if (source.provider === "tushare" && "ts_code" in source.parameters) {
          const codeIssue = validateTuShareStockCode(source.parameters.ts_code);
          if (codeIssue)
            blockingIssues.push(`${source.capability} 的 ${codeIssue}`);
        }
        capabilities.push(capability);
      }
    }
    if (draft.delivery.type === "FEISHU") {
      if (!hasDeliveryTarget("FEISHU", draft.delivery.targetRef)) {
        blockingIssues.push("飞书投递目标未配置或不可用");
      }
    }
    const nextRunAt = blockingIssues.length
      ? null
      : await this.nextRunAt(draft.schedule);
    if (!nextRunAt) blockingIssues.push("无法计算下一次执行时间");
    const status = blockingIssues.length
      ? "NEEDS_CLARIFICATION"
      : warnings.length
        ? "SUPPORTED_WITH_LIMITS"
        : "SUPPORTED";
    const allowedCapabilities = [
      ...new Set(capabilities.map((item) => item.executionTool)),
    ];
    const rawDatasets = capabilities.flatMap((item) =>
      item.executionTool === "internal_tushare_dataset" && item.dataset
        ? [item.dataset]
        : [],
    );
    const scoringOutput =
      "type" in draft.output && draft.output.type === "SCORING_REPORT";
    if (draft.executionPlan && !scoringOutput)
      blockingIssues.push("确定性评分任务必须使用 SCORING_REPORT 输出类型");
    if (!draft.executionPlan && scoringOutput)
      blockingIssues.push("SCORING_REPORT 输出类型缺少确定性 executionPlan");
    const agentExecutionPlan = {
      allowedCapabilities,
      capabilityConstraints: rawDatasets.length
        ? {
            internal_tushare_dataset: {
              allowedDatasets: rawDatasets,
              maxRows: Math.min(
                ...capabilities
                  .filter((item) => item.dataset)
                  .map((item) => item.maxRows ?? 500),
              ),
              maxLookbackDays: Math.min(
                ...capabilities
                  .filter((item) => item.dataset)
                  .map((item) => item.maxLookbackDays ?? 365),
              ),
            },
          }
        : {},
      dataSources: draft.dataSources,
      objective: draft.userPrompt,
      output: draft.output,
    };
    const executionPlan = draft.executionPlan ?? agentExecutionPlan;
    return {
      ...draft,
      executionPlan,
      nextRunAt: nextRunAt?.toISOString() ?? null,
      feasibility: { status, warnings, blockingIssues },
    };
  }

  async buildDraft(params: {
    userId: string;
    conversationId: string;
    idempotencyKey: string;
    value: unknown;
  }) {
    const validated = await this.validateDraft(params.value);
    const feasibility = asRecord(validated.feasibility);
    if (
      feasibility.status !== "SUPPORTED" &&
      feasibility.status !== "SUPPORTED_WITH_LIMITS"
    ) {
      throw new Error("草稿尚未通过验证，不能保存为可确认版本");
    }
    const draft = validated as ScheduledTaskDraftInput &
      Record<string, unknown>;
    const duplicate = await this.db.scheduledTaskVersion.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      include: { task: true },
    });
    if (duplicate) return this.preview(duplicate.task.id);

    const task = await this.db.$transaction(async (tx) => {
      const existing = await tx.scheduledTask.findFirst({
        where: {
          userId: params.userId,
          status: "DRAFT",
          setupConversationId: params.conversationId,
        },
        orderBy: { updatedAt: "desc" },
      });
      const version = existing ? existing.currentVersion + 1 : 1;
      const versionData = {
        version,
        userPrompt: draft.userPrompt,
        scheduleSpec: draft.schedule as unknown as Prisma.InputJsonObject,
        dataSources: draft.dataSources as unknown as Prisma.InputJsonArray,
        executionPlan: draft.executionPlan as Prisma.InputJsonObject,
        outputSpec: draft.output as Prisma.InputJsonObject,
        deliverySpec: draft.delivery as Prisma.InputJsonObject,
        feasibility: draft.feasibility as Prisma.InputJsonObject,
        idempotencyKey: params.idempotencyKey,
      };
      const saved = existing
        ? await tx.scheduledTask.update({
            where: { id: existing.id },
            data: {
              name: draft.name,
              timezone: draft.schedule.timezone,
              nextRunAt: new Date(String(draft.nextRunAt)),
              currentVersion: version,
              versions: { create: versionData },
            },
          })
        : await tx.scheduledTask.create({
            data: {
              userId: params.userId,
              name: draft.name,
              status: "DRAFT",
              timezone: draft.schedule.timezone,
              nextRunAt: new Date(String(draft.nextRunAt)),
              setupConversationId: params.conversationId,
              currentVersion: version,
              versions: { create: versionData },
            },
          });
      await tx.agentConversation.updateMany({
        where: { id: params.conversationId, userId: params.userId },
        data: {
          routingMode: "SCHEDULED_TASK_SETUP",
          activeScheduledTaskDraftId: saved.id,
        },
      });
      return saved;
    });
    return this.preview(task.id);
  }

  async preview(taskId: string) {
    const task = await this.db.scheduledTask.findUnique({
      where: { id: taskId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!task || !task.versions[0]) return null;
    const version = task.versions[0];
    return {
      taskId: task.id,
      version: version.version,
      name: task.name,
      schedule: version.scheduleSpec,
      dataSources: version.dataSources,
      executionPlan: version.executionPlan,
      output: version.outputSpec,
      delivery: version.deliverySpec,
      feasibility: version.feasibility,
      nextRunAt: task.nextRunAt?.toISOString() ?? null,
    };
  }
}

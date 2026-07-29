import { z } from "zod";
import {
  type CompanyOverview,
  companyOverviewWithQuestionsSchema,
} from "~/contracts/company-overview";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PythonCompanyOverviewClient } from "~/server/infrastructure/intelligence/python-company-overview-client";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

const questionSchema = z
  .array(z.string().trim().min(8).max(80))
  .length(4)
  .refine((items) => new Set(items).size === items.length, {
    message: "问题不能重复",
  });
const questionCache = new Map<string, string[]>();

function fallbackQuestions(
  section: "profile" | "financials" | "businesses",
  overview: CompanyOverview,
) {
  const name = overview.companyName;
  if (section === "profile") {
    return [
      `${name}的核心产品分别服务哪些客户和场景？`,
      `${name}主要业务的收入确认与定价机制是什么？`,
      `${name}在产业链中的议价能力由哪些因素决定？`,
      `${name}当前主营业务最直接的竞争对手有哪些？`,
    ];
  }
  if (section === "financials") {
    const latest = overview.financials.quarters[0];
    return [
      `${name}${latest ? "最近一期" : "后续"}财务指标变化的核心驱动是什么？`,
      `${name}利润表各指标的变化来自产品结构、价格还是成本？`,
      `${name}经营现金流与利润表现是否匹配，差异来自哪里？`,
      `${name}资产负债结构中最值得持续跟踪的变化是什么？`,
    ];
  }
  const leading = overview.businesses[0]?.name ?? "主营业务";
  return [
    `${name}的${leading}为何能成为当前最重要的收入来源？`,
    `${name}各业务中真正的利润中心是哪一项？`,
    `${name}高增长业务的增长质量与可持续性如何验证？`,
    `${name}收缩或低效业务是否会拖累整体回报？`,
  ];
}

async function buildQuestions(
  section: "profile" | "financials" | "businesses",
  overview: CompanyOverview,
) {
  const key = `${section}:${overview.stockCode}:${overview.updatedAt.slice(0, 10)}`;
  const cached = questionCache.get(key);
  if (cached) return cached;
  const fallback = fallbackQuestions(section, overview);
  const source =
    section === "profile"
      ? overview.profile
      : section === "financials"
        ? overview.financials
        : overview.businesses;
  const questions = await new DeepSeekClient().completeContract(
    [
      {
        role: "system",
        content:
          "你是A股基本面研究员。仅输出 JSON 字符串数组，必须恰好四条、中文、每条针对给定公司的事实提出可验证问题，不要泛泛而谈。",
      },
      {
        role: "user",
        content: JSON.stringify({
          company: overview.companyName,
          stockCode: overview.stockCode,
          section,
          data: source,
        }),
      },
    ],
    fallback,
    questionSchema,
    {
      model: "deepseek-v4-flash",
      maxOutputTokens: 360,
      maxStructuredOutputRetries: 1,
    },
  );
  questionCache.set(key, questions);
  return questions;
}

export const companyOverviewRouter = createTRPCRouter({
  get: protectedProcedure
    .input(z.object({
      stockCode: z.string().regex(/^\d{6}$/),
      metricIds: z.array(z.string().min(1)).max(30).default([]),
    }))
    .query(async ({ input }) => {
      const overview = await new PythonCompanyOverviewClient().getOverview(
        input.stockCode,
        input.metricIds,
      );
      const [profile, financials, businesses] = await Promise.all([
        buildQuestions("profile", overview),
        buildQuestions("financials", overview),
        buildQuestions("businesses", overview),
      ]);
      return companyOverviewWithQuestionsSchema.parse({
        ...overview,
        questions: { profile, financials, businesses },
      });
    }),
  bars: protectedProcedure
    .input(
      z.object({
        stockCode: z.string().regex(/^\d{6}$/),
        timeframe: z.enum([
          "DAILY",
          "WEEKLY",
          "MONTHLY",
          "MINUTE_60",
          "MINUTE_30",
          "MINUTE_15",
          "MINUTE_1",
        ]),
        // 热力图预览使用 TuShare daily 的未复权原始行情；详情页沿用前复权。
        adjust: z.enum(["qfq", "hfq", ""]).optional().default("qfq"),
      }),
    )
    .query(({ input }) =>
      new PythonTimingDataClient().getBars({
        stockCode: input.stockCode,
        timeframe: input.timeframe,
        adjust: input.adjust,
      }),
    ),
});

import { z } from "zod";

const nullableNumber = z.number().nullable();

export const companyFinancialPointSchema = z.object({
  endDate: z.string(),
  revenue: nullableNumber,
  netProfit: nullableNumber,
  deductedNetProfit: nullableNumber,
  grossMargin: nullableNumber,
  netMargin: nullableNumber,
  operatingCashflow: nullableNumber,
  freeCashflow: nullableNumber,
  roe: nullableNumber,
  roic: nullableNumber,
});

export const companyOverviewSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  tsCode: z.string(),
  companyName: z.string(),
  exchange: z.string(),
  updatedAt: z.string(),
  profile: z.object({
    introduction: z.string().nullable(),
    mainBusiness: z.string().nullable(),
    businessScope: z.string().nullable(),
  }),
  financials: z.object({
    quarters: z.array(companyFinancialPointSchema),
    annuals: z.array(companyFinancialPointSchema),
    valuation: z.object({
      asOfDate: z.string().nullable(),
      pe: nullableNumber,
      pb: nullableNumber,
      ps: nullableNumber,
    }),
  }),
  businesses: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
      revenueGrowth: nullableNumber,
      history: z.array(
        z.object({
          year: z.string(),
          revenue: nullableNumber,
          revenueShare: nullableNumber,
          profit: nullableNumber,
          grossMargin: nullableNumber,
        }),
      ),
    }),
  ),
});

export const companyOverviewWithQuestionsSchema = companyOverviewSchema.extend({
  questions: z.object({
    profile: z.array(z.string()).length(4),
    financials: z.array(z.string()).length(4),
    businesses: z.array(z.string()).length(4),
  }),
});

export type CompanyOverview = z.infer<typeof companyOverviewSchema>;
export type CompanyOverviewWithQuestions = z.infer<
  typeof companyOverviewWithQuestionsSchema
>;

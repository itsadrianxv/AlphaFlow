import { z } from "zod";

const nullableNumber = z.number().nullable();

export const companyFinancialPointSchema = z.object({
  endDate: z.string(),
  values: z.record(z.string(), nullableNumber),
});

export const companyFinancialMetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataset: z.enum(["income", "balancesheet", "cashflow"]),
  field: z.string(),
  displayUnit: z.string(),
  valueKind: z.enum(["currency", "ratio", "per_share", "shares", "number"]),
  periodSemantics: z.string(),
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
    metrics: z.array(companyFinancialMetricSchema),
    quarters: z.array(companyFinancialPointSchema),
    annuals: z.array(companyFinancialPointSchema),
    warnings: z.array(z.unknown()).default([]),
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

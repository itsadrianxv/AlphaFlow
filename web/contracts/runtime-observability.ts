import { z } from "zod";

export const runtimeMetricFilterSchema = z.object({
  source: z.string().trim().min(1).optional(),
  dataset: z.string().trim().min(1).optional(),
  stage: z.string().trim().min(1).optional(),
  resourcePool: z.string().trim().min(1).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  asOfTradingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  rollingTradingDays: z.number().int().min(1).max(366).optional(),
});

export const runtimeReleaseCheckSchema = z.object({
  id: z.string().trim().min(1),
  status: z.enum(["PASS", "FAIL", "NOT_RUN", "MANUAL_REQUIRED"]),
  evidence: z.string().trim().max(2_000).optional(),
  reason: z.string().trim().max(2_000).optional(),
});

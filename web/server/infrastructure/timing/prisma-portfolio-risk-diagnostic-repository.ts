import type { Prisma, PrismaClient } from "@prisma/client";
import type { PortfolioRiskDiagnostic, PortfolioRiskDiagnosticRecord } from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export class PrismaPortfolioRiskDiagnosticRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    userId: string;
    workflowRunId?: string;
    portfolioCompositionId: string;
    asOfDate: string;
    diagnostic: PortfolioRiskDiagnostic;
  }): Promise<PortfolioRiskDiagnosticRecord> {
    const record = await this.prisma.portfolioRiskDiagnostic.create({
      data: {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        portfolioCompositionId: params.portfolioCompositionId,
        asOfDate: new Date(`${params.asOfDate}T00:00:00.000Z`),
        concentration: toJson(params.diagnostic.concentration),
        exposures: toJson(params.diagnostic.exposures),
        correlation: toJson(params.diagnostic.correlation),
        volatility: toJson(params.diagnostic.volatility),
        liquidity: toJson(params.diagnostic.liquidity),
        scenarios: toJson(params.diagnostic.scenarios),
        dataQuality: toJson(params.diagnostic.dataQuality),
      },
    });
    return {
      id: record.id,
      userId: record.userId,
      workflowRunId: record.workflowRunId,
      portfolioCompositionId: record.portfolioCompositionId,
      asOfDate: record.asOfDate.toISOString().slice(0, 10),
      createdAt: record.createdAt,
      concentration: record.concentration as PortfolioRiskDiagnostic["concentration"],
      exposures: record.exposures as PortfolioRiskDiagnostic["exposures"],
      correlation: record.correlation as PortfolioRiskDiagnostic["correlation"],
      volatility: record.volatility as PortfolioRiskDiagnostic["volatility"],
      liquidity: record.liquidity as PortfolioRiskDiagnostic["liquidity"],
      scenarios: record.scenarios as PortfolioRiskDiagnostic["scenarios"],
      dataQuality: record.dataQuality as PortfolioRiskDiagnostic["dataQuality"],
    };
  }
}

import { InvalidInsightError } from "~/modules/research/server/domain/intelligence/errors";
import type { InsightConfidence } from "~/modules/research/server/domain/intelligence/types";

const CONFIDENCE_LEVELS: InsightConfidence[] = ["high", "medium", "low"];

export type InvestmentThesisParams = {
  summary: string;
  whyNow: string;
  drivers: string[];
  monetizationPath: string;
  confidence: InsightConfidence;
};

export class InvestmentThesis {
  private readonly _summary: string;
  private readonly _whyNow: string;
  private readonly _drivers: readonly string[];
  private readonly _monetizationPath: string;
  private readonly _confidence: InsightConfidence;

  private constructor(params: InvestmentThesisParams) {
    this._summary = params.summary;
    this._whyNow = params.whyNow;
    this._drivers = [...params.drivers];
    this._monetizationPath = params.monetizationPath;
    this._confidence = params.confidence;
  }

  get summary(): string {
    return this._summary;
  }

  get whyNow(): string {
    return this._whyNow;
  }

  get drivers(): readonly string[] {
    return this._drivers;
  }

  get monetizationPath(): string {
    return this._monetizationPath;
  }

  get confidence(): InsightConfidence {
    return this._confidence;
  }

  static create(params: InvestmentThesisParams): InvestmentThesis {
    if (!params.summary.trim()) {
      throw new InvalidInsightError("投资结论摘要不能为空");
    }

    if (!params.whyNow.trim()) {
      throw new InvalidInsightError("whyNow 不能为空");
    }

    if (!params.monetizationPath.trim()) {
      throw new InvalidInsightError("兑现路径不能为空");
    }

    const drivers = params.drivers
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (drivers.length === 0) {
      throw new InvalidInsightError("至少需要一个核心驱动");
    }

    if (!CONFIDENCE_LEVELS.includes(params.confidence)) {
      throw new InvalidInsightError("无效的 thesis 置信度");
    }

    return new InvestmentThesis({
      summary: params.summary.trim(),
      whyNow: params.whyNow.trim(),
      drivers,
      monetizationPath: params.monetizationPath.trim(),
      confidence: params.confidence,
    });
  }

  toDict(): Record<string, unknown> {
    return {
      summary: this._summary,
      whyNow: this._whyNow,
      drivers: [...this._drivers],
      monetizationPath: this._monetizationPath,
      confidence: this._confidence,
    };
  }

  static fromDict(data: Record<string, unknown>): InvestmentThesis {
    return InvestmentThesis.create({
      summary: data.summary as string,
      whyNow: data.whyNow as string,
      drivers: data.drivers as string[],
      monetizationPath: data.monetizationPath as string,
      confidence: data.confidence as InsightConfidence,
    });
  }
}

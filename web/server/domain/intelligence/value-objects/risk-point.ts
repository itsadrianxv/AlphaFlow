import { InvalidInsightError } from "~/server/domain/intelligence/errors";
import type { RiskSeverity } from "~/server/domain/intelligence/types";

const RISK_SEVERITIES: RiskSeverity[] = ["high", "medium", "low"];

export type RiskPointParams = {
  title: string;
  severity: RiskSeverity;
  description: string;
  monitorMetric: string;
  invalidatesThesisWhen: string;
};

export class RiskPoint {
  private readonly _title: string;
  private readonly _severity: RiskSeverity;
  private readonly _description: string;
  private readonly _monitorMetric: string;
  private readonly _invalidatesThesisWhen: string;

  private constructor(params: RiskPointParams) {
    this._title = params.title;
    this._severity = params.severity;
    this._description = params.description;
    this._monitorMetric = params.monitorMetric;
    this._invalidatesThesisWhen = params.invalidatesThesisWhen;
  }

  get title(): string {
    return this._title;
  }

  get severity(): RiskSeverity {
    return this._severity;
  }

  get description(): string {
    return this._description;
  }

  get monitorMetric(): string {
    return this._monitorMetric;
  }

  get invalidatesThesisWhen(): string {
    return this._invalidatesThesisWhen;
  }

  static create(params: RiskPointParams): RiskPoint {
    if (!params.title.trim()) {
      throw new InvalidInsightError("风险标题不能为空");
    }

    if (!params.description.trim()) {
      throw new InvalidInsightError("风险描述不能为空");
    }

    if (!params.monitorMetric.trim()) {
      throw new InvalidInsightError("风险监控指标不能为空");
    }

    if (!params.invalidatesThesisWhen.trim()) {
      throw new InvalidInsightError("风险失效条件不能为空");
    }

    if (!RISK_SEVERITIES.includes(params.severity)) {
      throw new InvalidInsightError("无效的风险严重度");
    }

    return new RiskPoint({
      title: params.title.trim(),
      severity: params.severity,
      description: params.description.trim(),
      monitorMetric: params.monitorMetric.trim(),
      invalidatesThesisWhen: params.invalidatesThesisWhen.trim(),
    });
  }

  toDict(): Record<string, unknown> {
    return {
      title: this._title,
      severity: this._severity,
      description: this._description,
      monitorMetric: this._monitorMetric,
      invalidatesThesisWhen: this._invalidatesThesisWhen,
    };
  }

  static fromDict(data: Record<string, unknown>): RiskPoint {
    return RiskPoint.create({
      title: data.title as string,
      severity: data.severity as RiskSeverity,
      description: data.description as string,
      monitorMetric: data.monitorMetric as string,
      invalidatesThesisWhen: data.invalidatesThesisWhen as string,
    });
  }
}

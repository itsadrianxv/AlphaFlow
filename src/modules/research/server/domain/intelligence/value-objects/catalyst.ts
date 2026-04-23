import { InvalidInsightError } from "~/modules/research/server/domain/intelligence/errors";
import type { CatalystWindowType } from "~/modules/research/server/domain/intelligence/types";

const CATALYST_WINDOW_TYPES: CatalystWindowType[] = [
  "event",
  "earnings",
  "policy",
  "product",
  "order",
];

export type CatalystParams = {
  title: string;
  windowType: CatalystWindowType;
  importance: number;
  description: string;
  expectedDate?: string;
  sourceRefId?: string;
};

export class Catalyst {
  private readonly _title: string;
  private readonly _windowType: CatalystWindowType;
  private readonly _importance: number;
  private readonly _description: string;
  private readonly _expectedDate?: string;
  private readonly _sourceRefId?: string;

  private constructor(params: CatalystParams) {
    this._title = params.title;
    this._windowType = params.windowType;
    this._importance = params.importance;
    this._description = params.description;
    this._expectedDate = params.expectedDate;
    this._sourceRefId = params.sourceRefId;
  }

  get title(): string {
    return this._title;
  }

  get windowType(): CatalystWindowType {
    return this._windowType;
  }

  get importance(): number {
    return this._importance;
  }

  get description(): string {
    return this._description;
  }

  get expectedDate(): string | undefined {
    return this._expectedDate;
  }

  get sourceRefId(): string | undefined {
    return this._sourceRefId;
  }

  static create(params: CatalystParams): Catalyst {
    if (!params.title.trim()) {
      throw new InvalidInsightError("催化标题不能为空");
    }

    if (!params.description.trim()) {
      throw new InvalidInsightError("催化描述不能为空");
    }

    if (
      !Number.isInteger(params.importance) ||
      params.importance < 1 ||
      params.importance > 5
    ) {
      throw new InvalidInsightError("催化重要性必须为 1 到 5 的整数");
    }

    if (!CATALYST_WINDOW_TYPES.includes(params.windowType)) {
      throw new InvalidInsightError("无效的催化窗口类型");
    }

    return new Catalyst({
      title: params.title.trim(),
      windowType: params.windowType,
      importance: params.importance,
      description: params.description.trim(),
      expectedDate: params.expectedDate,
      sourceRefId: params.sourceRefId,
    });
  }

  toDict(): Record<string, unknown> {
    return {
      title: this._title,
      windowType: this._windowType,
      importance: this._importance,
      description: this._description,
      expectedDate: this._expectedDate,
      sourceRefId: this._sourceRefId,
    };
  }

  static fromDict(data: Record<string, unknown>): Catalyst {
    return Catalyst.create({
      title: data.title as string,
      windowType: data.windowType as CatalystWindowType,
      importance: data.importance as number,
      description: data.description as string,
      expectedDate: data.expectedDate as string | undefined,
      sourceRefId: data.sourceRefId as string | undefined,
    });
  }
}

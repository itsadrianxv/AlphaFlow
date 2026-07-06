/**
 * ScreeningSession 聚合根
 *
 * 记录一次筛选任务的执行快照。
 * 在异步执行模型下，它既承担任务状态记录，也承担最终结果快照存储。
 */

import { v4 as uuidv4 } from "uuid";
import { FilterGroup } from "../entities/filter-group";
import { ScreeningSessionStatus } from "../enums/screening-session-status";
import { ScoredStock } from "../value-objects/scored-stock";
import { ScoringConfig } from "../value-objects/scoring-config";
import type { ScreeningResult } from "../value-objects/screening-result";
import { StockCode } from "../value-objects/stock-code";

export interface CreateScreeningSessionParams {
  strategyId: string | null;
  strategyName: string;
  userId: string;
  result: ScreeningResult;
  filtersSnapshot: FilterGroup;
  scoringConfigSnapshot: ScoringConfig;
  id?: string;
  executedAt?: Date;
}

export interface CreatePendingScreeningSessionParams {
  strategyId: string | null;
  strategyName: string;
  userId: string;
  filtersSnapshot: FilterGroup;
  scoringConfigSnapshot: ScoringConfig;
  id?: string;
  executedAt?: Date;
}

export class ScreeningSession {
  private readonly _id: string;
  private readonly _strategyId: string | null;
  private readonly _strategyName: string;
  private readonly _userId: string;
  private readonly _executedAt: Date;
  private _totalScanned: number;
  private _executionTime: number;
  private _topStocks: readonly ScoredStock[];
  private _otherStockCodes: readonly StockCode[];
  private readonly _filtersSnapshot: FilterGroup;
  private readonly _scoringConfigSnapshot: ScoringConfig;
  private _status: ScreeningSessionStatus;
  private _progressPercent: number;
  private _currentStep: string | null;
  private _errorMessage: string | null;
  private _cancellationRequestedAt: Date | null;
  private _startedAt: Date | null;
  private _completedAt: Date | null;

  private static readonly TOP_STOCKS_THRESHOLD = 50;

  private constructor(params: {
    id: string;
    strategyId: string | null;
    strategyName: string;
    userId: string;
    executedAt: Date;
    totalScanned: number;
    executionTime: number;
    topStocks: ScoredStock[];
    otherStockCodes: StockCode[];
    filtersSnapshot: FilterGroup;
    scoringConfigSnapshot: ScoringConfig;
    status: ScreeningSessionStatus;
    progressPercent: number;
    currentStep: string | null;
    errorMessage: string | null;
    cancellationRequestedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
  }) {
    this._id = params.id;
    this._strategyId = params.strategyId;
    this._strategyName = params.strategyName;
    this._userId = params.userId;
    this._executedAt = params.executedAt;
    this._totalScanned = params.totalScanned;
    this._executionTime = params.executionTime;
    this._topStocks = [...params.topStocks];
    this._otherStockCodes = [...params.otherStockCodes];
    this._filtersSnapshot = params.filtersSnapshot;
    this._scoringConfigSnapshot = params.scoringConfigSnapshot;
    this._status = params.status;
    this._progressPercent = params.progressPercent;
    this._currentStep = params.currentStep;
    this._errorMessage = params.errorMessage;
    this._cancellationRequestedAt = params.cancellationRequestedAt;
    this._startedAt = params.startedAt;
    this._completedAt = params.completedAt;
  }

  get id(): string {
    return this._id;
  }

  get strategyId(): string | null {
    return this._strategyId;
  }

  get strategyName(): string {
    return this._strategyName;
  }

  get userId(): string {
    return this._userId;
  }

  get executedAt(): Date {
    return this._executedAt;
  }

  get totalScanned(): number {
    return this._totalScanned;
  }

  get executionTime(): number {
    return this._executionTime;
  }

  get topStocks(): readonly ScoredStock[] {
    return this._topStocks;
  }

  get otherStockCodes(): readonly StockCode[] {
    return this._otherStockCodes;
  }

  get filtersSnapshot(): FilterGroup {
    return this._filtersSnapshot;
  }

  get scoringConfigSnapshot(): ScoringConfig {
    return this._scoringConfigSnapshot;
  }

  get status(): ScreeningSessionStatus {
    return this._status;
  }

  get progressPercent(): number {
    return this._progressPercent;
  }

  get currentStep(): string | null {
    return this._currentStep;
  }

  get errorMessage(): string | null {
    return this._errorMessage;
  }

  get cancellationRequestedAt(): Date | null {
    return this._cancellationRequestedAt;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get completedAt(): Date | null {
    return this._completedAt;
  }

  static create(params: CreateScreeningSessionParams): ScreeningSession {
    const session = ScreeningSession.createPending({
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      userId: params.userId,
      filtersSnapshot: params.filtersSnapshot,
      scoringConfigSnapshot: params.scoringConfigSnapshot,
      id: params.id,
      executedAt: params.executedAt,
    });

    session.markRunning("同步执行");
    session.complete(params.result);
    return session;
  }

  static createPending(
    params: CreatePendingScreeningSessionParams,
  ): ScreeningSession {
    return new ScreeningSession({
      id: params.id ?? uuidv4(),
      strategyId: params.strategyId,
      strategyName: params.strategyName,
      userId: params.userId,
      executedAt: params.executedAt ?? new Date(),
      totalScanned: 0,
      executionTime: 0,
      topStocks: [],
      otherStockCodes: [],
      filtersSnapshot: params.filtersSnapshot,
      scoringConfigSnapshot: params.scoringConfigSnapshot,
      status: ScreeningSessionStatus.PENDING,
      progressPercent: 0,
      currentStep: "排队中",
      errorMessage: null,
      cancellationRequestedAt: null,
      startedAt: null,
      completedAt: null,
    });
  }

  markRunning(step = "开始执行"): void {
    if (this._status === ScreeningSessionStatus.CANCELLED) {
      return;
    }

    this._status = ScreeningSessionStatus.RUNNING;
    this._startedAt = this._startedAt ?? new Date();
    this._currentStep = step;
    this._errorMessage = null;
    this._progressPercent = Math.max(this._progressPercent, 1);
  }

  updateProgress(progressPercent: number, step?: string): void {
    this._progressPercent = Math.max(
      0,
      Math.min(99, Math.round(progressPercent)),
    );
    if (step !== undefined) {
      this._currentStep = step;
    }
  }

  requestCancellation(): void {
    this._cancellationRequestedAt = this._cancellationRequestedAt ?? new Date();
    if (this._status === ScreeningSessionStatus.PENDING) {
      this.cancel("已取消");
    }
  }

  isCancellationRequested(): boolean {
    return this._cancellationRequestedAt !== null;
  }

  cancel(message = "已取消"): void {
    this._status = ScreeningSessionStatus.CANCELLED;
    this._currentStep = message;
    this._errorMessage = null;
    this._completedAt = new Date();
  }

  fail(message: string): void {
    this._status = ScreeningSessionStatus.FAILED;
    this._currentStep = "执行失败";
    this._errorMessage = message;
    this._completedAt = new Date();
  }

  complete(result: ScreeningResult): void {
    const matchedStocks = result.matchedStocks;
    const topStocks = matchedStocks.slice(
      0,
      ScreeningSession.TOP_STOCKS_THRESHOLD,
    );
    const otherStocks = matchedStocks.slice(
      ScreeningSession.TOP_STOCKS_THRESHOLD,
    );

    this._topStocks = topStocks;
    this._otherStockCodes = otherStocks.map((stock) => stock.stockCode);
    this._totalScanned = result.totalScanned;
    this._executionTime = result.executionTime;
    this._status = ScreeningSessionStatus.SUCCEEDED;
    this._progressPercent = 100;
    this._currentStep = "筛选完成";
    this._errorMessage = null;
    this._completedAt = new Date();
  }

  countMatched(): number {
    return this._topStocks.length + this._otherStockCodes.length;
  }

  getAllMatchedCodes(): StockCode[] {
    const topCodes = this._topStocks.map((stock) => stock.stockCode);
    return [...topCodes, ...this._otherStockCodes];
  }

  getStockDetail(code: StockCode): ScoredStock | null {
    return (
      this._topStocks.find((stock) => stock.stockCode.equals(code)) ?? null
    );
  }

  getTopN(n: number): ScoredStock[] {
    return this._topStocks.slice(0, n);
  }

  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      strategyId: this._strategyId,
      strategyName: this._strategyName,
      userId: this._userId,
      executedAt: this._executedAt.toISOString(),
      totalScanned: this._totalScanned,
      executionTime: this._executionTime,
      topStocks: this._topStocks.map((stock) => stock.toDict()),
      otherStockCodes: this._otherStockCodes.map((code) => code.value),
      filtersSnapshot: this._filtersSnapshot.toDict(),
      scoringConfigSnapshot: this._scoringConfigSnapshot.toDict(),
      status: this._status,
      progressPercent: this._progressPercent,
      currentStep: this._currentStep,
      errorMessage: this._errorMessage,
      cancellationRequestedAt:
        this._cancellationRequestedAt?.toISOString() ?? null,
      startedAt: this._startedAt?.toISOString() ?? null,
      completedAt: this._completedAt?.toISOString() ?? null,
    };
  }

  static fromDict(data: Record<string, unknown>): ScreeningSession {
    const topStocksData = Array.isArray(data.topStocks)
      ? (data.topStocks as Record<string, unknown>[])
      : [];
    const otherStockCodesData = Array.isArray(data.otherStockCodes)
      ? (data.otherStockCodes as string[])
      : [];

    return new ScreeningSession({
      id: data.id as string,
      strategyId: (data.strategyId as string | null) ?? null,
      strategyName: data.strategyName as string,
      userId: data.userId as string,
      executedAt: new Date(data.executedAt as string),
      totalScanned: (data.totalScanned as number) ?? 0,
      executionTime: (data.executionTime as number) ?? 0,
      topStocks: topStocksData.map((stockData) =>
        ScoredStock.fromDict(stockData),
      ),
      otherStockCodes: otherStockCodesData.map((code) =>
        StockCode.create(code),
      ),
      filtersSnapshot: FilterGroup.fromDict(
        data.filtersSnapshot as Record<string, unknown>,
      ),
      scoringConfigSnapshot: ScoringConfig.fromDict(
        data.scoringConfigSnapshot as Record<string, unknown>,
      ),
      status:
        (data.status as ScreeningSessionStatus | undefined) ??
        ScreeningSessionStatus.SUCCEEDED,
      progressPercent: (data.progressPercent as number | undefined) ?? 100,
      currentStep: (data.currentStep as string | null | undefined) ?? null,
      errorMessage: (data.errorMessage as string | null | undefined) ?? null,
      cancellationRequestedAt: data.cancellationRequestedAt
        ? new Date(data.cancellationRequestedAt as string)
        : null,
      startedAt: data.startedAt ? new Date(data.startedAt as string) : null,
      completedAt: data.completedAt
        ? new Date(data.completedAt as string)
        : null,
    });
  }

  equals(other: ScreeningSession | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._id === other._id;
  }

  toString(): string {
    return `ScreeningSession(${this._id}, ${this._strategyName}, ${this._status})`;
  }
}

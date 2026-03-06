# LangGraph Agents 完整编码方案（签名级，2026-03-06）

## 1. 目标与范围

本方案用于在当前 T3 Stack + Python FastAPI 基线上，落地 `workflow` 与 `intelligence` 两个上下文，优先交付：

1. 固定 5-Agent 的快速行业研究工作流（可运行）
2. 异步执行（长任务不阻塞 tRPC 请求）
3. Redis checkpoint + 事件推送（支持断点恢复）
4. 前端可见任务进度、节点状态、最终报告
5. PostgreSQL 完整审计（run / node / event）

本轮不强制：

1. 用户自定义 DAG 编辑器
2. 多租户配额与计费
3. 全数据源生态（先保留 AkShare + DeepSeek）

---

## 2. 架构约束与关键决策

1. 保持 DDD 分层：`domain`（纯业务）→ `application`（编排）→ `infrastructure`（实现）
2. `screening` 与 `intelligence` 不直接互相依赖；跨上下文由 `workflow` 应用层编排
3. 采用「PostgreSQL 记账 + Redis 状态」双存储：
   - PostgreSQL：最终真相（模板、运行、节点、事件）
   - Redis：LangGraph checkpoint 与实时事件分发
4. Worker 与 Web 进程分离：
   - `web` 负责创建任务与查询
   - `workflow-worker` 负责执行图
5. tRPC 为唯一应用入口；前端实时流用 Next Route Handler 提供 SSE

---

## 3. 端到端时序（最终行为）

1. 前端调用 `workflow.startQuickResearch`
2. Web 进程写入 `WorkflowRun(PENDING)` + 初始化 NodeRun + Event
3. Worker 轮询领取 `PENDING` 任务并置为 `RUNNING`
4. Worker 执行 LangGraph（5 节点），每个节点写 NodeRun + Event，并发布 Redis 进度
5. SSE 路由订阅 Redis 频道，将事件推送前端
6. 成功后写 `WorkflowRun(SUCCEEDED)` + 结构化报告；失败写 `FAILED`
7. Worker 异常退出后可按 Redis checkpoint 恢复

---

## 4. 目录级落地清单（与现仓库对齐）

```text
src/server/
├── api/
│   └── routers/
│       └── workflow.ts
├── application/
│   ├── workflow/
│   │   ├── workflow-command-service.ts
│   │   ├── workflow-query-service.ts
│   │   └── workflow-execution-service.ts
│   ├── intelligence/
│   │   └── intelligence-agent-service.ts
│   └── screening/
│       └── screening-facade.ts
├── domain/
│   ├── workflow/
│   │   ├── aggregates/
│   │   ├── entities/
│   │   ├── enums/
│   │   ├── repositories/
│   │   └── value-objects/
│   └── intelligence/
│       ├── entities/
│       ├── repositories/
│       └── value-objects/
└── infrastructure/
    ├── workflow/
    │   ├── prisma/
    │   ├── redis/
    │   └── langgraph/
    │       ├── graphs/
    │       └── nodes/
    ├── intelligence/
    └── screening/

src/app/
├── workflows/page.tsx
├── workflows/[runId]/page.tsx
└── api/workflows/runs/[runId]/events/route.ts

tooling/workers/
└── workflow-worker.ts

python_services/app/
├── routers/intelligence_data.py
└── services/intelligence_data_adapter.py
```

---

## 5. Prisma 模型设计（字段级）

### 5.1 枚举

```prisma
enum WorkflowRunStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum WorkflowNodeRunStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  SKIPPED
}

enum WorkflowEventType {
  RUN_CREATED
  RUN_STARTED
  RUN_CANCEL_REQUESTED
  RUN_CANCELLED
  RUN_SUCCEEDED
  RUN_FAILED
  NODE_STARTED
  NODE_PROGRESS
  NODE_SUCCEEDED
  NODE_FAILED
}
```

### 5.2 模型

```prisma
model WorkflowTemplate {
  id            String   @id @default(cuid())
  code          String
  version       Int
  name          String
  description   String?
  graphConfig   Json
  inputSchema   Json
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  runs          WorkflowRun[]

  @@unique([code, version])
  @@index([code, isActive])
}

model WorkflowRun {
  id                      String            @id @default(cuid())
  templateId              String
  userId                  String
  query                   String
  input                   Json
  status                  WorkflowRunStatus @default(PENDING)
  progressPercent         Int               @default(0)
  currentNodeKey          String?
  checkpointKey           String?
  result                  Json?
  errorCode               String?
  errorMessage            String?
  cancellationRequestedAt DateTime?
  startedAt               DateTime?
  completedAt             DateTime?
  createdAt               DateTime          @default(now())
  updatedAt               DateTime          @updatedAt

  template                WorkflowTemplate  @relation(fields: [templateId], references: [id], onDelete: Restrict)
  user                    User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  nodeRuns                WorkflowNodeRun[]
  events                  WorkflowEvent[]

  @@index([userId, createdAt])
  @@index([status, createdAt])
  @@index([templateId, createdAt])
}

model WorkflowNodeRun {
  id           String                @id @default(cuid())
  runId         String
  nodeKey       String
  agentName     String
  attempt       Int                   @default(1)
  status        WorkflowNodeRunStatus @default(PENDING)
  input         Json?
  output        Json?
  errorCode     String?
  errorMessage  String?
  durationMs    Int?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt

  run           WorkflowRun           @relation(fields: [runId], references: [id], onDelete: Cascade)
  events        WorkflowEvent[]

  @@unique([runId, nodeKey, attempt])
  @@index([runId, nodeKey])
  @@index([status, createdAt])
}

model WorkflowEvent {
  id         String            @id @default(cuid())
  runId       String
  nodeRunId   String?
  sequence    Int
  eventType   WorkflowEventType
  payload     Json
  occurredAt  DateTime          @default(now())

  run         WorkflowRun       @relation(fields: [runId], references: [id], onDelete: Cascade)
  nodeRun     WorkflowNodeRun?  @relation(fields: [nodeRunId], references: [id], onDelete: SetNull)

  @@unique([runId, sequence])
  @@index([runId, occurredAt])
  @@index([eventType, occurredAt])
}
```

---

## 6. TypeScript 签名级设计

## 6.1 Shared 类型（建议新增 `src/server/application/workflow/dto.ts`）

```ts
export type WorkflowNodeKey =
  | "agent1_industry_overview"
  | "agent2_market_heat"
  | "agent3_candidate_screening"
  | "agent4_credibility_batch"
  | "agent5_competition_summary";

export interface QuickResearchInput {
  readonly query: string;
  readonly marketScope?: "A_SHARE";
  readonly maxCandidates?: number;
}

export interface IndustryIntentDto {
  readonly theme: string;
  readonly keywords: readonly string[];
  readonly screeningHints: {
    readonly industries: readonly string[];
    readonly minMarketCap?: number;
    readonly preferredIndicators: readonly string[];
  };
}

export interface CandidateStockDto {
  readonly code: string;
  readonly name: string;
  readonly reason: string;
}

export interface CredibilityResultDto {
  readonly stockCode: string;
  readonly score: number;
  readonly level: "HIGH" | "MEDIUM" | "LOW";
  readonly riskNote: string;
  readonly evidenceSummary: string;
}

export interface QuickResearchResultDto {
  readonly overview: string;
  readonly heatScore: number;
  readonly heatConclusion: string;
  readonly candidates: readonly CandidateStockDto[];
  readonly credibility: readonly CredibilityResultDto[];
  readonly topPicks: readonly CandidateStockDto[];
  readonly competitionSummary: string;
  readonly generatedAt: string;
}
```

## 6.2 Workflow Domain

### 6.2.1 枚举与错误

`src/server/domain/workflow/enums/workflow-run-status.ts`

```ts
export type WorkflowRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
```

`src/server/domain/workflow/enums/workflow-node-run-status.ts`

```ts
export type WorkflowNodeRunStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED";
```

`src/server/domain/workflow/errors.ts`

```ts
export class WorkflowDomainError extends Error {}
export class InvalidWorkflowStatusTransitionError extends WorkflowDomainError {}
export class WorkflowCancellationError extends WorkflowDomainError {}
export class WorkflowTemplateNotFoundError extends WorkflowDomainError {}
```

### 6.2.2 聚合与实体

`src/server/domain/workflow/aggregates/workflow-run.ts`

```ts
import type { WorkflowNodeKey, QuickResearchInput, QuickResearchResultDto } from "~/server/application/workflow/dto";
import type { WorkflowRunStatus } from "~/server/domain/workflow/enums/workflow-run-status";

export interface WorkflowRunFailure {
  readonly code: string;
  readonly message: string;
}

export interface WorkflowRunProps {
  readonly id: string;
  readonly templateId: string;
  readonly userId: string;
  readonly query: string;
  readonly input: QuickResearchInput;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  status: WorkflowRunStatus;
  progressPercent: number;
  currentNodeKey: WorkflowNodeKey | null;
  checkpointKey: string | null;
  result: QuickResearchResultDto | null;
  failure: WorkflowRunFailure | null;
  cancellationRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateWorkflowRunParams {
  readonly id: string;
  readonly templateId: string;
  readonly userId: string;
  readonly query: string;
  readonly input: QuickResearchInput;
  readonly createdAt: Date;
}

export class WorkflowRun {
  static create(params: CreateWorkflowRunParams): WorkflowRun;
  static rehydrate(props: WorkflowRunProps): WorkflowRun;

  get id(): string;
  get templateId(): string;
  get userId(): string;
  get status(): WorkflowRunStatus;

  markRunning(now: Date): void;
  updateProgress(nodeKey: WorkflowNodeKey, percent: number): void;
  requestCancellation(now: Date): void;
  markCancelled(now: Date): void;
  markSucceeded(result: QuickResearchResultDto, now: Date): void;
  markFailed(failure: WorkflowRunFailure, now: Date): void;

  toPrimitives(): WorkflowRunProps;
}
```

`src/server/domain/workflow/entities/workflow-node-run.ts`

```ts
import type { WorkflowNodeKey } from "~/server/application/workflow/dto";
import type { WorkflowNodeRunStatus } from "~/server/domain/workflow/enums/workflow-node-run-status";

export interface WorkflowNodeRunProps {
  readonly id: string;
  readonly runId: string;
  readonly nodeKey: WorkflowNodeKey;
  readonly agentName: string;
  readonly attempt: number;
  readonly status: WorkflowNodeRunStatus;
  readonly input: Record<string, unknown> | null;
  readonly output: Record<string, unknown> | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly durationMs: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

export class WorkflowNodeRun {
  static createPending(params: {
    id: string;
    runId: string;
    nodeKey: WorkflowNodeKey;
    agentName: string;
    attempt: number;
  }): WorkflowNodeRun;
  static rehydrate(props: WorkflowNodeRunProps): WorkflowNodeRun;

  markRunning(now: Date, input: Record<string, unknown>): void;
  markSucceeded(now: Date, output: Record<string, unknown>): void;
  markFailed(now: Date, code: string, message: string): void;

  toPrimitives(): WorkflowNodeRunProps;
}
```

### 6.2.3 仓储接口

`src/server/domain/workflow/repositories/workflow-template-repository.ts`

```ts
export interface WorkflowTemplateRecord {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly name: string;
  readonly description: string | null;
  readonly graphConfig: Record<string, unknown>;
  readonly inputSchema: Record<string, unknown>;
  readonly isActive: boolean;
}

export interface IWorkflowTemplateRepository {
  findActiveByCode(code: string): Promise<WorkflowTemplateRecord | null>;
  findByCodeAndVersion(code: string, version: number): Promise<WorkflowTemplateRecord | null>;
  save(record: WorkflowTemplateRecord): Promise<void>;
}
```

`src/server/domain/workflow/repositories/workflow-run-repository.ts`

```ts
import type { WorkflowRun } from "~/server/domain/workflow/aggregates/workflow-run";
import type { WorkflowNodeRun } from "~/server/domain/workflow/entities/workflow-node-run";
import type { WorkflowRunStatus } from "~/server/domain/workflow/enums/workflow-run-status";

export interface WorkflowEventRecord {
  readonly runId: string;
  readonly nodeRunId: string | null;
  readonly eventType:
    | "RUN_CREATED"
    | "RUN_STARTED"
    | "RUN_CANCEL_REQUESTED"
    | "RUN_CANCELLED"
    | "RUN_SUCCEEDED"
    | "RUN_FAILED"
    | "NODE_STARTED"
    | "NODE_PROGRESS"
    | "NODE_SUCCEEDED"
    | "NODE_FAILED";
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface ListWorkflowRunsQuery {
  readonly userId: string;
  readonly status?: WorkflowRunStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkflowRunListItem {
  readonly id: string;
  readonly query: string;
  readonly status: WorkflowRunStatus;
  readonly progressPercent: number;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface WorkflowRunDetail {
  readonly run: WorkflowRun;
  readonly nodeRuns: readonly WorkflowNodeRun[];
  readonly latestEvents: readonly WorkflowEventRecord[];
}

export interface IWorkflowRunRepository {
  save(run: WorkflowRun): Promise<void>;
  findById(runId: string): Promise<WorkflowRun | null>;
  findByIdForUser(runId: string, userId: string): Promise<WorkflowRun | null>;
  findDetailForUser(runId: string, userId: string): Promise<WorkflowRunDetail | null>;
  listByUser(query: ListWorkflowRunsQuery): Promise<readonly WorkflowRunListItem[]>;
  claimNextPendingRun(workerId: string): Promise<WorkflowRun | null>;
  saveNodeRun(nodeRun: WorkflowNodeRun): Promise<void>;
  appendEvent(event: WorkflowEventRecord): Promise<number>; // 返回 sequence
  isCancellationRequested(runId: string): Promise<boolean>;
}
```

## 6.3 Intelligence Domain

`src/server/domain/intelligence/value-objects/industry-intent.ts`

```ts
export interface IndustryIntent {
  readonly theme: string;
  readonly keywords: readonly string[];
  readonly timeframeDays: number;
  readonly screeningHints: {
    readonly industries: readonly string[];
    readonly minMarketCap?: number;
  };
}
```

`src/server/domain/intelligence/value-objects/evidence.ts`

```ts
export interface CompanyEvidence {
  readonly stockCode: string;
  readonly announcements: readonly string[];
  readonly mainBusiness: string;
  readonly rdInvestmentSummary: string;
  readonly relatedNews: readonly string[];
}
```

`src/server/domain/intelligence/repositories/intelligence-data-repository.ts`

```ts
import type { CompanyEvidence } from "~/server/domain/intelligence/value-objects/evidence";

export interface ThemeNewsItem {
  readonly title: string;
  readonly source: string;
  readonly publishedAt: string;
  readonly url: string;
}

export interface IIntelligenceDataRepository {
  getThemeNews(params: { theme: string; days: number; limit: number }): Promise<readonly ThemeNewsItem[]>;
  getCompanyEvidence(params: { stockCode: string; concept: string }): Promise<CompanyEvidence>;
  getCompanyEvidenceBatch(params: { stockCodes: readonly string[]; concept: string }): Promise<readonly CompanyEvidence[]>;
}
```

`src/server/domain/intelligence/repositories/intelligence-llm-repository.ts`

```ts
import type { CompanyEvidence } from "~/server/domain/intelligence/value-objects/evidence";
import type { IndustryIntentDto, CredibilityResultDto } from "~/server/application/workflow/dto";

export interface MarketHeatResult {
  readonly score: number;
  readonly conclusion: string;
  readonly keySignals: readonly string[];
}

export interface CompetitionSummaryResult {
  readonly summary: string;
  readonly tableMarkdown: string;
  readonly investmentSuggestion: string;
}

export interface IIntelligenceLlmRepository {
  parseIntent(query: string): Promise<IndustryIntentDto>;
  generateIndustryOverview(params: { intent: IndustryIntentDto }): Promise<string>;
  analyzeMarketHeat(params: { intent: IndustryIntentDto; news: readonly string[] }): Promise<MarketHeatResult>;
  verifyCredibility(params: { concept: string; evidence: CompanyEvidence }): Promise<CredibilityResultDto>;
  summarizeCompetition(params: {
    concept: string;
    topPicks: readonly { code: string; name: string; score: number }[];
  }): Promise<CompetitionSummaryResult>;
}
```

## 6.4 Application 层（编排）

### 6.4.1 Workflow Command Service

`src/server/application/workflow/workflow-command-service.ts`

```ts
import type { QuickResearchInput } from "~/server/application/workflow/dto";

export interface StartQuickResearchCommand {
  readonly userId: string;
  readonly query: string;
  readonly templateCode: "quick_industry_research";
  readonly templateVersion?: number;
  readonly idempotencyKey?: string;
}

export interface StartQuickResearchResult {
  readonly runId: string;
  readonly status: "PENDING";
  readonly createdAt: string;
}

export interface CancelWorkflowRunCommand {
  readonly userId: string;
  readonly runId: string;
}

export class WorkflowCommandService {
  constructor(deps: {
    templateRepository: import("~/server/domain/workflow/repositories/workflow-template-repository").IWorkflowTemplateRepository;
    runRepository: import("~/server/domain/workflow/repositories/workflow-run-repository").IWorkflowRunRepository;
    idGenerator: { newId(): string };
    clock: { now(): Date };
  });

  startQuickResearch(command: StartQuickResearchCommand): Promise<StartQuickResearchResult>;
  cancelRun(command: CancelWorkflowRunCommand): Promise<void>;
}
```

### 6.4.2 Workflow Query Service

`src/server/application/workflow/workflow-query-service.ts`

```ts
export interface GetWorkflowRunQuery {
  readonly userId: string;
  readonly runId: string;
}

export interface ListWorkflowRunsQuery {
  readonly userId: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
}

export interface WorkflowRunDto {
  readonly id: string;
  readonly query: string;
  readonly status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly progressPercent: number;
  readonly currentNodeKey: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface WorkflowRunDetailDto extends WorkflowRunDto {
  readonly result: Record<string, unknown> | null;
  readonly failure: { code: string; message: string } | null;
  readonly nodes: readonly {
    id: string;
    nodeKey: string;
    agentName: string;
    status: string;
    attempt: number;
    durationMs: number | null;
    errorMessage: string | null;
  }[];
}

export class WorkflowQueryService {
  constructor(deps: {
    runRepository: import("~/server/domain/workflow/repositories/workflow-run-repository").IWorkflowRunRepository;
  });

  getRun(query: GetWorkflowRunQuery): Promise<WorkflowRunDetailDto>;
  listRuns(query: ListWorkflowRunsQuery): Promise<readonly WorkflowRunDto[]>;
}
```

### 6.4.3 Workflow Execution Service（Worker 调用）

`src/server/application/workflow/workflow-execution-service.ts`

```ts
export interface ExecuteNextRunOptions {
  readonly workerId: string;
}

export class WorkflowExecutionService {
  constructor(deps: {
    runRepository: import("~/server/domain/workflow/repositories/workflow-run-repository").IWorkflowRunRepository;
    graphRunner: import("~/server/infrastructure/workflow/langgraph/graphs/quick-industry-research-graph").QuickIndustryResearchGraphRunner;
    checkpointStore: import("~/server/infrastructure/workflow/redis/checkpoint-store").ICheckpointStore;
    progressBus: import("~/server/infrastructure/workflow/redis/progress-bus").IWorkflowProgressBus;
    clock: { now(): Date };
  });

  executeNextPendingRun(options: ExecuteNextRunOptions): Promise<boolean>; // 是否领取到任务
  executeRunById(runId: string, workerId: string): Promise<void>;
}
```

### 6.4.4 Intelligence Agent Service

`src/server/application/intelligence/intelligence-agent-service.ts`

```ts
import type {
  CandidateStockDto,
  CredibilityResultDto,
  IndustryIntentDto,
} from "~/server/application/workflow/dto";

export class IntelligenceAgentService {
  constructor(deps: {
    dataRepository: import("~/server/domain/intelligence/repositories/intelligence-data-repository").IIntelligenceDataRepository;
    llmRepository: import("~/server/domain/intelligence/repositories/intelligence-llm-repository").IIntelligenceLlmRepository;
  });

  parseIntent(query: string): Promise<IndustryIntentDto>;
  buildIndustryOverview(intent: IndustryIntentDto): Promise<string>;
  analyzeMarketHeat(intent: IndustryIntentDto): Promise<{ score: number; conclusion: string; keySignals: readonly string[] }>;
  verifyCredibilityBatch(input: {
    concept: string;
    candidates: readonly CandidateStockDto[];
  }): Promise<readonly CredibilityResultDto[]>;
  summarizeCompetition(input: {
    concept: string;
    topPicks: readonly CandidateStockDto[];
  }): Promise<{ summary: string; tableMarkdown: string; investmentSuggestion: string }>;
}
```

### 6.4.5 Screening Facade（复用现有 screening 能力）

`src/server/application/screening/screening-facade.ts`

```ts
import type { CandidateStockDto, IndustryIntentDto } from "~/server/application/workflow/dto";

export interface IScreeningFacade {
  quickScreenByIntent(input: {
    userId: string;
    intent: IndustryIntentDto;
    limit: number;
  }): Promise<readonly CandidateStockDto[]>;
}
```

## 6.5 Infrastructure 层

### 6.5.1 Prisma Repository 实现

`src/server/infrastructure/workflow/prisma/prisma-workflow-template-repository.ts`

```ts
export class PrismaWorkflowTemplateRepository
  implements import("~/server/domain/workflow/repositories/workflow-template-repository").IWorkflowTemplateRepository {
  constructor(private readonly prisma: import("~/generated/prisma").PrismaClient) {}

  findActiveByCode(code: string): Promise<import("~/server/domain/workflow/repositories/workflow-template-repository").WorkflowTemplateRecord | null>;
  findByCodeAndVersion(code: string, version: number): Promise<import("~/server/domain/workflow/repositories/workflow-template-repository").WorkflowTemplateRecord | null>;
  save(record: import("~/server/domain/workflow/repositories/workflow-template-repository").WorkflowTemplateRecord): Promise<void>;
}
```

`src/server/infrastructure/workflow/prisma/prisma-workflow-run-repository.ts`

```ts
export class PrismaWorkflowRunRepository
  implements import("~/server/domain/workflow/repositories/workflow-run-repository").IWorkflowRunRepository {
  constructor(private readonly prisma: import("~/generated/prisma").PrismaClient) {}

  save(run: import("~/server/domain/workflow/aggregates/workflow-run").WorkflowRun): Promise<void>;
  findById(runId: string): Promise<import("~/server/domain/workflow/aggregates/workflow-run").WorkflowRun | null>;
  findByIdForUser(runId: string, userId: string): Promise<import("~/server/domain/workflow/aggregates/workflow-run").WorkflowRun | null>;
  findDetailForUser(runId: string, userId: string): Promise<import("~/server/domain/workflow/repositories/workflow-run-repository").WorkflowRunDetail | null>;
  listByUser(query: import("~/server/domain/workflow/repositories/workflow-run-repository").ListWorkflowRunsQuery): Promise<readonly import("~/server/domain/workflow/repositories/workflow-run-repository").WorkflowRunListItem[]>;
  claimNextPendingRun(workerId: string): Promise<import("~/server/domain/workflow/aggregates/workflow-run").WorkflowRun | null>;
  saveNodeRun(nodeRun: import("~/server/domain/workflow/entities/workflow-node-run").WorkflowNodeRun): Promise<void>;
  appendEvent(event: import("~/server/domain/workflow/repositories/workflow-run-repository").WorkflowEventRecord): Promise<number>;
  isCancellationRequested(runId: string): Promise<boolean>;
}
```

### 6.5.2 Redis 组件

`src/server/infrastructure/workflow/redis/redis-client.ts`

```ts
export interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<number>;
  publish(channel: string, payload: string): Promise<number>;
  subscribe(channel: string, onMessage: (message: string) => void): Promise<() => Promise<void>>;
}

export function createRedisClient(url: string): IRedisClient;
```

`src/server/infrastructure/workflow/redis/checkpoint-store.ts`

```ts
export interface WorkflowCheckpoint {
  readonly runId: string;
  readonly state: Record<string, unknown>;
  readonly savedAt: string;
}

export interface ICheckpointStore {
  load(runId: string): Promise<WorkflowCheckpoint | null>;
  save(checkpoint: WorkflowCheckpoint): Promise<void>;
  clear(runId: string): Promise<void>;
}

export class RedisCheckpointStore implements ICheckpointStore {
  constructor(private readonly redis: import("~/server/infrastructure/workflow/redis/redis-client").IRedisClient) {}

  load(runId: string): Promise<WorkflowCheckpoint | null>;
  save(checkpoint: WorkflowCheckpoint): Promise<void>;
  clear(runId: string): Promise<void>;
}
```

`src/server/infrastructure/workflow/redis/progress-bus.ts`

```ts
export interface WorkflowProgressEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly type:
    | "RUN_STARTED"
    | "NODE_STARTED"
    | "NODE_PROGRESS"
    | "NODE_SUCCEEDED"
    | "NODE_FAILED"
    | "RUN_SUCCEEDED"
    | "RUN_FAILED"
    | "RUN_CANCELLED";
  readonly nodeKey?: string;
  readonly progressPercent: number;
  readonly timestamp: string;
  readonly payload: Record<string, unknown>;
}

export interface IWorkflowProgressBus {
  publish(event: WorkflowProgressEvent): Promise<void>;
  subscribe(runId: string, onEvent: (event: WorkflowProgressEvent) => void): Promise<() => Promise<void>>;
}

export class RedisWorkflowProgressBus implements IWorkflowProgressBus {
  constructor(private readonly redis: import("~/server/infrastructure/workflow/redis/redis-client").IRedisClient) {}

  publish(event: WorkflowProgressEvent): Promise<void>;
  subscribe(runId: string, onEvent: (event: WorkflowProgressEvent) => void): Promise<() => Promise<void>>;
}
```

### 6.5.3 LLM 与 Python 客户端

`src/server/infrastructure/intelligence/deepseek-client.ts`

```ts
export interface DeepseekChatJsonRequest<TSchema extends Record<string, unknown>> {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly schema: TSchema;
  readonly temperature?: number;
}

export interface IDeepseekClient {
  chatJson<TOutput extends Record<string, unknown>>(
    request: DeepseekChatJsonRequest<Record<string, unknown>>,
  ): Promise<TOutput>;
}

export class DeepseekClient implements IDeepseekClient {
  constructor(config: { apiKey: string; baseUrl?: string; timeoutMs?: number }) {}

  chatJson<TOutput extends Record<string, unknown>>(
    request: DeepseekChatJsonRequest<Record<string, unknown>>,
  ): Promise<TOutput>;
}
```

`src/server/infrastructure/intelligence/python-intelligence-data-client.ts`

```ts
import type { CompanyEvidence } from "~/server/domain/intelligence/value-objects/evidence";
import type { IIntelligenceDataRepository, ThemeNewsItem } from "~/server/domain/intelligence/repositories/intelligence-data-repository";

export class PythonIntelligenceDataClient implements IIntelligenceDataRepository {
  constructor(config: { baseUrl: string; timeoutMs?: number }) {}

  getThemeNews(params: { theme: string; days: number; limit: number }): Promise<readonly ThemeNewsItem[]>;
  getCompanyEvidence(params: { stockCode: string; concept: string }): Promise<CompanyEvidence>;
  getCompanyEvidenceBatch(params: { stockCodes: readonly string[]; concept: string }): Promise<readonly CompanyEvidence[]>;
}
```

## 6.6 LangGraph 签名设计

### 6.6.1 State

`src/server/infrastructure/workflow/langgraph/state.ts`

```ts
import type {
  CandidateStockDto,
  CredibilityResultDto,
  IndustryIntentDto,
  QuickResearchResultDto,
  WorkflowNodeKey,
} from "~/server/application/workflow/dto";

export interface QuickIndustryResearchState {
  readonly runId: string;
  readonly userId: string;
  readonly query: string;

  intent: IndustryIntentDto | null;
  industryOverview: string | null;
  heatAnalysis:
    | {
        score: number;
        conclusion: string;
        keySignals: readonly string[];
      }
    | null;
  candidates: readonly CandidateStockDto[];
  credibility: readonly CredibilityResultDto[];
  competition:
    | {
        summary: string;
        tableMarkdown: string;
        investmentSuggestion: string;
      }
    | null;
  finalReport: QuickResearchResultDto | null;

  currentNodeKey: WorkflowNodeKey | null;
  progressPercent: number;
  errors: readonly { nodeKey: WorkflowNodeKey; code: string; message: string }[];
}

export function createInitialState(input: {
  runId: string;
  userId: string;
  query: string;
}): QuickIndustryResearchState;
```

### 6.6.2 节点依赖与函数签名

`src/server/infrastructure/workflow/langgraph/nodes/types.ts`

```ts
import type { QuickIndustryResearchState } from "~/server/infrastructure/workflow/langgraph/state";

export interface AgentNodeDeps {
  readonly intelligenceService: import("~/server/application/intelligence/intelligence-agent-service").IntelligenceAgentService;
  readonly screeningFacade: import("~/server/application/screening/screening-facade").IScreeningFacade;
  readonly runRepository: import("~/server/domain/workflow/repositories/workflow-run-repository").IWorkflowRunRepository;
  readonly progressBus: import("~/server/infrastructure/workflow/redis/progress-bus").IWorkflowProgressBus;
  readonly clock: { now(): Date };
}

export type AgentNode = (
  state: QuickIndustryResearchState,
) => Promise<Partial<QuickIndustryResearchState>>;
```

节点文件签名：

`agent1-industry-overview.ts`

```ts
export function createAgent1IndustryOverviewNode(deps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps): import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNode;
```

`agent2-heat-analysis.ts`

```ts
export function createAgent2HeatAnalysisNode(deps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps): import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNode;
```

`agent3-candidate-screening.ts`

```ts
export function createAgent3CandidateScreeningNode(deps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps): import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNode;
```

`agent4-credibility-batch.ts`

```ts
export function createAgent4CredibilityBatchNode(deps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps): import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNode;
```

`agent5-competition-summary.ts`

```ts
export function createAgent5CompetitionSummaryNode(deps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps): import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNode;
```

### 6.6.3 图构建器

`src/server/infrastructure/workflow/langgraph/graphs/quick-industry-research-graph.ts`

```ts
import type { QuickIndustryResearchState } from "~/server/infrastructure/workflow/langgraph/state";

export interface QuickIndustryResearchGraphRunner {
  invoke(state: QuickIndustryResearchState): Promise<QuickIndustryResearchState>;
}

export function buildQuickIndustryResearchGraph(deps: {
  nodeDeps: import("~/server/infrastructure/workflow/langgraph/nodes/types").AgentNodeDeps;
  checkpointStore: import("~/server/infrastructure/workflow/redis/checkpoint-store").ICheckpointStore;
}): QuickIndustryResearchGraphRunner;
```

## 6.7 tRPC Router 签名设计

`src/server/api/routers/workflow.ts`

```ts
import { z } from "zod";

export const startQuickResearchInputSchema = z.object({
  query: z.string().min(4).max(120),
  templateCode: z.literal("quick_industry_research").default("quick_industry_research"),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const getRunInputSchema = z.object({
  runId: z.string().cuid2().or(z.string().cuid()),
});

export const listRunsInputSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
  status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(),
});

export const cancelRunInputSchema = z.object({
  runId: z.string().cuid2().or(z.string().cuid()),
});

export const workflowRouter = createTRPCRouter({
  startQuickResearch: protectedProcedure
    .input(startQuickResearchInputSchema)
    .mutation(/* Promise<{ runId: string; status: "PENDING"; createdAt: string }> */),

  getRun: protectedProcedure
    .input(getRunInputSchema)
    .query(/* Promise<WorkflowRunDetailDto> */),

  listRuns: protectedProcedure
    .input(listRunsInputSchema)
    .query(/* Promise<readonly WorkflowRunDto[]> */),

  cancelRun: protectedProcedure
    .input(cancelRunInputSchema)
    .mutation(/* Promise<{ success: true }> */),
});
```

## 6.8 SSE Route 签名

`src/app/api/workflows/runs/[runId]/events/route.ts`

```ts
export async function GET(
  request: Request,
  context: { params: { runId: string } },
): Promise<Response>;

function toSseChunk(event: import("~/server/infrastructure/workflow/redis/progress-bus").WorkflowProgressEvent): string;

function createSseResponse(stream: ReadableStream<Uint8Array>): Response;
```

鉴权规则：

1. Route 中调用 `auth()` 获取当前用户
2. 用 `WorkflowQueryService.getRun({ userId, runId })` 做权限校验
3. 仅通过校验后订阅 Redis channel `workflow:run:{runId}:events`

## 6.9 Worker 入口签名

`tooling/workers/workflow-worker.ts`

```ts
export interface WorkerBootstrapOptions {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly idleBackoffMs: number;
}

export async function bootstrapWorkflowWorker(options?: Partial<WorkerBootstrapOptions>): Promise<void>;

async function runLoop(ctx: {
  executionService: import("~/server/application/workflow/workflow-execution-service").WorkflowExecutionService;
  options: WorkerBootstrapOptions;
  signal: AbortSignal;
}): Promise<void>;
```

`package.json` 脚本建议：

```json
{
  "scripts": {
    "worker:workflow": "tsx tooling/workers/workflow-worker.ts"
  }
}
```

---

## 7. Python FastAPI 扩展（签名级）

## 7.1 服务层

`python_services/app/services/intelligence_data_adapter.py`

```python
from typing import TypedDict

class NewsItemDict(TypedDict):
    title: str
    source: str
    publishedAt: str
    url: str

class CompanyEvidenceDict(TypedDict):
    stockCode: str
    announcements: list[str]
    mainBusiness: str
    rdInvestmentSummary: str
    relatedNews: list[str]

class IntelligenceDataAdapter:
    @staticmethod
    def get_theme_news(theme: str, days: int = 7, limit: int = 100) -> list[NewsItemDict]: ...

    @staticmethod
    def get_company_evidence(stock_code: str, concept: str) -> CompanyEvidenceDict: ...

    @staticmethod
    def get_company_evidence_batch(stock_codes: list[str], concept: str) -> list[CompanyEvidenceDict]: ...
```

## 7.2 路由层

`python_services/app/routers/intelligence_data.py`

```python
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

router = APIRouter()

class NewsItem(BaseModel):
    title: str
    source: str
    publishedAt: str
    url: str

class CompanyEvidence(BaseModel):
    stockCode: str
    announcements: list[str]
    mainBusiness: str
    rdInvestmentSummary: str
    relatedNews: list[str]

class EvidenceBatchRequest(BaseModel):
    stockCodes: list[str] = Field(min_length=1)
    concept: str = Field(min_length=1)

@router.get("/intelligence/news", response_model=list[NewsItem])
async def get_theme_news(
    theme: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(100, ge=1, le=200),
) -> list[NewsItem]: ...

@router.get("/intelligence/evidence/{stock_code}", response_model=CompanyEvidence)
async def get_company_evidence(stock_code: str, concept: str = Query(..., min_length=1)) -> CompanyEvidence: ...

@router.post("/intelligence/evidence/batch", response_model=list[CompanyEvidence])
async def get_company_evidence_batch(request: EvidenceBatchRequest) -> list[CompanyEvidence]: ...
```

`python_services/app/main.py` 注册：

```python
from app.routers import intelligence_data
app.include_router(intelligence_data.router, prefix="/api", tags=["intelligence"])
```

---

## 8. 前端页面与 Hook 签名

`src/app/workflows/page.tsx`

```ts
export default async function WorkflowsPage(): Promise<JSX.Element>;
```

`src/app/workflows/[runId]/page.tsx`

```ts
export default async function WorkflowRunDetailPage(props: { params: Promise<{ runId: string }> }): Promise<JSX.Element>;
```

建议新增 `src/app/workflows/_components/use-workflow-events.ts`：

```ts
export interface WorkflowEventFeedState {
  readonly events: readonly import("~/server/infrastructure/workflow/redis/progress-bus").WorkflowProgressEvent[];
  readonly connectionState: "CONNECTING" | "OPEN" | "CLOSED" | "ERROR";
}

export function useWorkflowEvents(runId: string): WorkflowEventFeedState;
```

---

## 9. 错误码、幂等、恢复策略

## 9.1 错误码

1. `WORKFLOW_TEMPLATE_NOT_FOUND`
2. `WORKFLOW_RUN_NOT_FOUND`
3. `WORKFLOW_RUN_FORBIDDEN`
4. `WORKFLOW_INVALID_STATUS_TRANSITION`
5. `WORKFLOW_NODE_EXECUTION_FAILED`
6. `WORKFLOW_CANCEL_NOT_ALLOWED`
7. `INTELLIGENCE_DATA_UNAVAILABLE`
8. `INTELLIGENCE_LLM_PARSE_FAILED`

## 9.2 幂等

1. `workflow.startQuickResearch` 支持 `idempotencyKey`（建议落库到 `WorkflowRun.input`）
2. 同一 `userId + idempotencyKey` 若已有 `PENDING/RUNNING`，直接返回已有 `runId`

## 9.3 断点恢复

1. 每个节点成功后写 checkpoint：`workflow:checkpoint:{runId}`
2. Worker 启动时：优先恢复 `RUNNING` 且有 checkpoint 的 run
3. 恢复逻辑签名：

```ts
function restoreStateFromCheckpoint(
  runId: string,
  fallbackState: import("~/server/infrastructure/workflow/langgraph/state").QuickIndustryResearchState,
): Promise<import("~/server/infrastructure/workflow/langgraph/state").QuickIndustryResearchState>;
```

---

## 10. 测试计划（文件与签名级）

## 10.1 TS 单元测试

1. `src/server/domain/workflow/aggregates/__tests__/workflow-run.test.ts`
2. `src/server/application/workflow/__tests__/workflow-command-service.test.ts`
3. `src/server/application/workflow/__tests__/workflow-execution-service.test.ts`
4. `src/server/infrastructure/workflow/langgraph/__tests__/quick-industry-research-graph.test.ts`

关键测试函数签名示例：

```ts
it("startQuickResearch 应创建 PENDING run 与初始化事件", async () => {});
it("executeNextPendingRun 在 Agent3 后应写入候选股票", async () => {});
it("cancelRun 在 RUNNING 状态下应设置 cancellationRequestedAt", async () => {});
```

## 10.2 tRPC 集成测试

1. `src/server/api/routers/__tests__/workflow.test.ts`

```ts
it("workflow.startQuickResearch 返回 runId", async () => {});
it("workflow.getRun 对非本人 run 返回 FORBIDDEN", async () => {});
```

## 10.3 Python 测试

1. `python_services/tests/test_intelligence_data.py`

```python
def test_get_theme_news_success() -> None: ...
def test_get_company_evidence_batch_success() -> None: ...
```

---

## 11. 两周实施分解（可直接开工）

### 第 1 周（先打通链路）

1. Prisma 枚举/模型/迁移
2. Domain + Application（WorkflowCommand/Query）
3. tRPC `start/get/list/cancel`
4. Worker 启动与 `claimNextPendingRun`
5. Agent1 + Agent3 最小图验证

### 第 2 周（补齐 5-Agent + 前端实时）

1. Agent2/4/5 实现
2. Redis progress bus + SSE route
3. 详情页实时进度与结果渲染
4. 失败重试与取消路径回归测试
5. Python intelligence router + client 接入

---

## 12. 验收标准（DoD）

1. 前端可发起“快速了解某赛道”任务并拿到 `runId`
2. 请求返回时间 < 2s（任务异步执行）
3. 前端可实时看到节点状态变化（SSE）
4. 完成后可查看结构化结果（overview/heat/candidates/credibility/competition）
5. Worker 意外重启后可基于 checkpoint 继续执行
6. 新增模块通过 `npm run typecheck`、`npm test`、`python -m pytest`

---

## 13. 与现计划相比的增强点

1. 从“文件清单”升级为“文件 + 类型 + 函数签名”
2. 明确了 `workflow/intelligence/screening` 三者的应用层协作边界
3. 给出可直接编码的 tRPC / Worker / LangGraph / SSE / Python 端函数签名
4. 补充了幂等、错误码、恢复策略，避免后续返工

# Pi Agent Harness 集成设计备忘录

## 背景

本项目 AlphaFlow 已经具备股票筛选、行业研究、公司研究、择时分析、异步工作流和 Python 数据服务等投研基础能力。用户提出希望在应用中 build in [`earendil-works/pi`](https://github.com/earendil-works/pi) 这个 agent harness，使终端用户可以在 AlphaFlow 内使用诸如 [`Wind-Information-Co-Ltd/wind-skills`](https://github.com/Wind-Information-Co-Ltd/wind-skills) 这样的投研 skill。

本备忘录用于记录初步头脑风暴结论，重点评估实现价值、实现难度、主要风险和推荐推进路径。

## 总体判断

这个方向有较高产品价值，但不建议直接把 Pi 完整嵌入主应用进程。更合理的定义是：

> 受控投研 agent runtime + 金融 skill 编排层。

也就是说，AlphaFlow 应该把 Pi 或 Pi agent core 作为独立、受控、可审计的 agent runtime sidecar 来使用；主应用继续负责用户入口、权限、上下文、任务调度、数据边界、结果展示和审计。

## 维度评价

| 维度 | 评价 | 说明 |
| --- | --- | --- |
| 产品价值 | 高 | 与选股、行业研究、公司研究、择时工作流高度契合，可以增强开放式投研任务处理能力。 |
| 实现难度 | 中高 | 不是简单 npm install 后接聊天框，重点在权限隔离、工具治理、凭证管理、审计和长任务编排。 |
| 技术匹配度 | 较高 | Pi 是 TypeScript / Node 生态，本项目 Web 和 worker 也是 TypeScript；但外部金融 skill 可能依赖 CLI、文件系统、网络和本地配置。 |
| 安全风险 | 高 | Agent harness 默认继承启动进程权限，若不隔离，可能读写文件、执行子进程、访问网络和消耗敏感凭证。 |
| 数据合规风险 | 中高 | Wind、Tushare 等金融数据涉及授权、额度、数据来源标注和使用边界。 |
| 推荐推进方式 | 分阶段 POC | 先验证少数 prompt 型 skill，再接入少数只读工具型 skill，最后做 skill 商店和权限治理。 |

## 为什么值得做

### 1. 与项目现有投研闭环匹配

当前项目已经包含：

- screening：选股筛选与筛选工作台；
- watchlists：自选股与观察池；
- company research：公司研究；
- industry research：行业研究；
- timing：择时和组合观察；
- workflow runs：异步工作流执行；
- Python service：行情、主题、候选股、证据、可信度分析等数据网关。

这些能力为 agent harness 提供了真实业务上下文。Pi + skills 可以作为自然语言投研执行层，把用户的开放式问题路由到已有工作流、内部数据网关或外部金融 skill。

### 2. wind-skills 与 AlphaFlow 的场景重合度高

`wind-skills` 不是单一工具，而是一个金融 skill monorepo，包含数据获取类、agent 类和大量投研分析类 skill。例如：

- `wind-mcp-skill`：访问 Wind 金融数据；
- `tushare-finance-skill`：访问 Tushare Pro 数据；
- `equity-investment-thesis`：个股投资逻辑深度研究；
- `dcf-model`：DCF 估值建模；
- `post-market-debrief`：盘后复盘；
- `theme_leader_identification_skill`：题材龙头识别；
- `market_regime_switch_skill`：市场状态切换判断。

这些能力和 AlphaFlow 当前产品方向非常接近，不是泛 AI 能力，而是直接增强投研深度和投研覆盖面。

### 3. 可以补齐开放式研究任务

现有 LangGraph 工作流适合固定流程，例如固定行业研究、固定公司研究或固定择时链路。但用户经常会提出临时问题：

- “帮我分析某公司当前的预期差。”
- “今天这个题材谁最像龙头？”
- “这个公告对公司股价影响大吗？”
- “某个行业现在是进攻、防守还是震荡？”

这些需求很难全部产品化为固定按钮。Skill 机制可以提供更灵活的研究模板、工具路由和分析框架。

## 主要难点

### 1. Pi 默认不是权限沙箱

Pi README 明确说明，Pi 本身不内置文件系统、进程、网络或凭证访问限制。默认情况下，它继承启动进程的权限。

如果直接把 Pi 跑在 Web 或 worker 容器中，风险包括：

- skill 读取或写入应用文件；
- skill 执行子进程；
- skill 访问任意网络；
- skill 使用 Web/worker 容器中的敏感环境变量；
- skill 消耗 Wind、Tushare、LLM 等外部服务额度；
- 用户输入诱导 agent 越权执行非预期操作。

因此必须把 runtime 与主应用隔离。

### 2. wind-mcp-skill 是强工具型 skill

`wind-mcp-skill` 不是纯 prompt 模板。它的 `SKILL.md` 声明了如下能力：

- `child_process: true`
- `filesystem_read: true`
- `filesystem_write: true`
- `network: true`

其核心调用方式是进入 skill 目录后执行：

```bash
node scripts/cli.mjs call <server_type> <tool_name> <params_json>
```

这意味着接入它时必须治理 CLI 执行、参数构造、错误恢复、API Key 来源、数据来源标注和调用审计。

### 3. Skill 类型混杂，不能一刀切

`wind-skills` 中至少存在两类 skill：

- Prompt 型 skill：主要是研究框架、报告模板和分析步骤，例如 `equity-investment-thesis`；
- Tool 型 skill：会调用 CLI、MCP、网络或本地配置，例如 `wind-mcp-skill`。

这两类 skill 的接入方式不同：

- Prompt 型 skill 可以被解析为系统提示、任务模板或工作流 prompt；
- Tool 型 skill 必须放入受控运行环境，并通过 adapter 和 allowlist 执行。

## 推荐架构

### 1. 新增 agent-runtime sidecar

新增独立 Docker 服务，例如 `agent-runtime`：

- 运行 Pi CLI 或基于 `@earendil-works/pi-agent-core` 的薄封装；
- 与 Web/worker 分离部署；
- 只挂载必要的 skill 目录和临时工作目录；
- 不直接继承 Web/worker 的全部环境变量；
- 通过内部 HTTP、RPC 或队列接受任务；
- 对外只暴露受控 API，不暴露任意 shell。

### 2. Web 负责用户入口和审计

Next.js / tRPC 侧负责：

- 创建 `AgentRun`；
- 记录用户、空间、关联工作流、输入上下文；
- 校验权限和额度；
- 投递 agent 任务；
- 通过 SSE 或轮询展示运行状态；
- 展示最终报告、引用来源和工具调用轨迹。

### 3. Worker 负责任务编排

现有 workflow worker 可以继续承担长任务编排职责：

- 从队列获取 agent run；
- 调用 agent-runtime；
- 持久化中间事件；
- 处理超时、取消、失败重试；
- 将结果写回现有 workflow run 或新建 agent run 表。

### 4. Skill allowlist

第一阶段不要允许用户安装任意 GitHub skill。应使用 allowlist：

- 固定仓库来源；
- 固定 commit 或 release 版本；
- 固定 skill 列表；
- 固定工具权限；
- 固定外部数据源；
- 固定最大运行时长和调用次数。

建议首批 allowlist：

- `equity-investment-thesis`
- `market_regime_switch_skill`
- `theme_leader_identification_skill`
- `wind-mcp-skill` 的少数只读查询能力

### 5. 优先复用现有 Python 数据网关

并非所有金融数据都需要先走 Wind。AlphaFlow 已有 Python service，可以提供：

- A 股基础数据；
- 主题新闻；
- 候选股；
- 公司证据；
- 可信度分析；
- 缓存和降级能力。

建议 agent 工具路由优先使用内部数据网关，Wind 作为高质量补充数据源或授权用户的高级能力。

## 不建议的做法

### 1. 不建议把 Pi 直接嵌进 Web/worker 主进程

这样会扩大主应用权限面，并让外部 skill 共享 Web/worker 的运行权限、文件系统和环境变量。

### 2. 不建议一开始开放任意 skill 安装

如果用户可以安装任意 GitHub skill 并让 agent 自由执行，AlphaFlow 会从投研平台变成通用 agent 执行器，安全、合规和维护成本都会快速上升。

### 3. 不建议全量接入 wind-skills

`wind-skills` 中 skill 数量较多，且类型混杂。应先按产品场景筛选少数能力做验证，再逐步扩展。

## MVP 路线

### 阶段一：Prompt 型 skill POC

目标：验证 skill 作为投研模板的产品价值。

建议选择 `equity-investment-thesis`：

- 输入：股票代码、股票名称、用户关注点；
- 数据：优先使用 AlphaFlow 现有公司研究数据包；
- 输出：结构化个股投资逻辑报告；
- 不接 Wind MCP，不执行外部 CLI。

验收标准：

- 用户能在公司研究页发起一次 skill 分析；
- 运行记录可追踪；
- 报告结构稳定；
- 引用内部数据来源；
- 失败时有明确提示。

### 阶段二：受控接入 Wind MCP 只读能力

目标：验证工具型 skill 的受控执行。

建议只开放少数只读路径：

- 股票最新行情；
- 股票 K 线或区间行情；
- 财务指标；
- 公司公告；
- 金融新闻。

关键要求：

- Wind Key 由用户或系统以受控方式配置；
- 所有 Wind 调用写入审计日志；
- 每次调用记录 server_type、tool_name、params、耗时、错误码、数据来源；
- 输出必须标注 Wind 数据来源；
- 设置调用次数、超时和并发上限。

### 阶段三：产品化 Skill 商店

目标：让用户可发现、启用和管理投研 skill。

能力包括：

- skill 列表；
- skill 适用场景说明；
- skill 权限声明；
- skill 数据源声明；
- skill 成本和额度提示；
- skill 版本锁定；
- 管理员审核与启停；
- 用户级或空间级启用。

## 需要新增的核心概念

后续实现时可以考虑新增以下领域对象：

- `AgentRun`：一次 agent 执行；
- `AgentRunEvent`：流式事件、工具调用、状态变化；
- `SkillManifest`：已审核 skill 元信息；
- `SkillPermissionPolicy`：skill 权限策略；
- `ExternalCredentialBinding`：用户或租户级外部凭证绑定；
- `AgentToolCallAudit`：工具调用审计记录。

## 推荐目录结构

建议把 `agent-runtime` 作为独立的 Node/TypeScript sidecar，而不是放入 `python_services/`。原因是 Pi 与 wind skill 的执行链路主要在 Node 生态中，放入 Python service 会制造跨语言边界和部署职责混乱。

推荐结构：

```txt
docker/
  agent-runtime/
    Dockerfile

agent_runtime/
  package.json
  package-lock.json
  tsconfig.json
  src/
    server.ts
    pi-adapter.ts
    skill-registry.ts
    tool-policy.ts
    run-store.ts
    events.ts
  skills/
    wind-mcp-skill/
```

T3 Web 侧推荐新增一个限界上下文：

```txt
web/server/domain/agent-runtime/
  agent-run.ts
  agent-skill.ts
  agent-event.ts

web/server/application/agent-runtime/
  agent-runtime-command-service.ts
  agent-runtime-query-service.ts

web/server/infrastructure/agent-runtime/
  agent-runtime-client.ts
  agent-runtime-event-client.ts

web/server/api/routers/
  agent-runtime.ts

web/app/agent-runtime/
  page.tsx
  agent-runtime-client.tsx
  run-detail-client.tsx
```

职责边界：

- `agent_runtime/` 负责运行 Pi、执行受控 skill、产生日志和事件；
- `web/server/domain/agent-runtime/` 负责本项目内的任务、权限、审计和状态表达；
- `web/server/infrastructure/agent-runtime/` 只负责调用 `agent-runtime` HTTP/SSE API；
- `web/app/agent-runtime/` 负责用户发起任务、查看执行过程和消费最终产物；
- `python_services/` 继续作为数据网关和内部金融数据服务，不承载 Pi runtime。

## Pi 源码与依赖策略

不建议第一阶段把 Pi 源码 clone 到 `python_services/agent_harness` 后再删除 TUI。Pi 是 TypeScript/Node 生态，直接放入 Python 服务目录会让职责、镜像、依赖和升级边界都变得模糊。

优先级建议如下：

1. 第一优先：依赖 Pi 的核心包

   在 `agent_runtime/package.json` 中引入 Pi 的 core 能力，例如：

   ```json
   {
     "dependencies": {
       "@earendil-works/pi-agent-core": "固定版本",
       "@earendil-works/pi-ai": "固定版本"
     }
   }
   ```

   本项目只写薄 adapter：把 AlphaFlow 的任务、skill registry、工具 allowlist、事件流和审计模型接到 Pi 的 agent loop 上。

2. 第二优先：固定 commit 的 vendor 目录

   如果 npm 包能力不足，或者需要审计和锁定上游实现，可以把 Pi 以固定 commit 引入：

   ```txt
   vendor/
     pi/
   ```

   这比放到 `python_services/` 更清晰。`vendor/pi` 应保持接近上游，只在 `agent_runtime/src/pi-adapter.ts` 中做适配。

3. 第三优先：fork 并裁剪

   只有在以下情况才考虑 fork/裁剪 Pi：

   - Pi core 没有暴露足够的状态恢复、事件、tool call hook；
   - 需要对 tool loop 做强约束，但官方扩展点不够；
   - TUI/CLI 依赖显著增加镜像体积或攻击面；
   - 需要长期维护与 AlphaFlow 深度绑定的 agent runtime。

即使 fork，也不应直接修改成项目私有逻辑散落在业务代码中。推荐保留一个小而明确的 `pi-adapter` 层，把上游 Pi 与本项目运行时隔离。

## agent-runtime 容器边界

`agent-runtime` 不应被设计为“给 agent 一个 shell”。它应该是一个受控内部服务：

```txt
web / workflow-worker
  -> agent-runtime HTTP API
    -> Pi agent loop
      -> skill router
        -> allowlisted tools
          -> wind-mcp-skill CLI / Python 数据网关 / LLM
```

容器内允许存在 Node、Pi runtime、skill 文件、临时工作目录和必要凭证，但外部只能通过受控 API 访问，不能暴露任意命令执行入口。

建议 `agent-runtime` 提供的最小 API：

```txt
GET  /health
GET  /skills
POST /runs
GET  /runs/:runId
GET  /runs/:runId/events
POST /runs/:runId/cancel
```

关键运行约束：

- 不挂载整个项目根目录；
- skill 目录只读挂载；
- 临时目录使用 `tmpfs` 或专门 volume；
- 只注入 `agent-runtime` 需要的凭证，例如 `WIND_API_KEY`；
- 不继承 Web/worker 容器的全部环境变量；
- 通过 allowlist 限制 skill、server_type、tool_name 和参数 schema；
- 限制单次任务超时、最大工具调用次数、最大 token、最大输出体积；
- 保存 tool call、参数摘要、错误、耗时和数据来源，支持后续审计。

需要明确：Docker 容器是隔离执行环境，但默认不是完整安全沙箱。更准确的表述是：

> `agent-runtime` 是一个 Docker 隔离的受控 agent 执行环境，通过只读挂载、最小凭证、工具 allowlist、资源限制和审计日志来降低风险。

## Docker Compose 与 Dockerfile 草案

`docker/docker-compose.yml` 中可以新增 `agent-runtime`：

```yaml
agent-runtime:
  build:
    context: ..
    dockerfile: docker/agent-runtime/Dockerfile
  restart: unless-stopped
  environment:
    NODE_ENV: development
    PORT: "8020"
    AGENT_RUNTIME_WORKDIR: /tmp/agent-runs
    WIND_API_KEY: ${WIND_API_KEY:-}
    PYTHON_SERVICE_URL: ${PYTHON_SERVICE_URL:-http://python-service:8000}
  read_only: true
  tmpfs:
    - /tmp
  volumes:
    - ../agent_runtime:/app/agent_runtime
    - ../agent_runtime/skills:/app/skills:ro
    - agent_runtime_cache:/app/cache
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true
  mem_limit: 1g
  cpus: 1.0
  ports:
    - "${AGENT_RUNTIME_PORT:-8020}:8020"
  healthcheck:
    test:
      [
        "CMD",
        "node",
        "-e",
        "fetch('http://localhost:8020/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
      ]
    interval: 15s
    timeout: 5s
    retries: 10
```

同时在 `web` 和 `workflow-worker` 中增加：

```yaml
AGENT_RUNTIME_URL: ${AGENT_RUNTIME_URL:-http://agent-runtime:8020}
```

并在 `depends_on` 中依赖 `agent-runtime` 的 healthcheck。

`docker/agent-runtime/Dockerfile` 第一版可以保持简单：

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app/agent_runtime

COPY agent_runtime/package*.json ./
RUN npm ci

COPY agent_runtime ./

ENV NODE_ENV=production
ENV PORT=8020

EXPOSE 8020

CMD ["npm", "run", "start"]
```

开发期如果需要热更新，可以通过 compose 挂载 `../agent_runtime:/app/agent_runtime` 并运行 `npm run dev`。生产镜像则应复制固定版本代码和固定版本 skill，不依赖宿主机目录。

如果接入 `wind-mcp-skill`，Dockerfile 或构建脚本还需要确保：

- 容器内有 Node 运行时；
- skill 的 npm 依赖已安装；
- skill 目录位于固定路径，例如 `/app/skills/wind-mcp-skill`；
- CLI 调用路径固定，不从用户输入拼接任意路径；
- Wind 相关凭证只通过环境变量或受控 secret 注入。

## Skill Registry 与工具策略

需要一个显式 skill manifest，避免 agent 自行扫描和执行未知 skill：

```yaml
skills:
  - id: wind-mcp
    name: Wind MCP Skill
    type: tool
    path: /app/skills/wind-mcp-skill
    entry:
      kind: node-cli
      command: node
      args:
        - scripts/cli.mjs
        - call
    allowed_tools:
      - server_type: stock
        tool_name: stock_data
      - server_type: financial
        tool_name: financial_indicators
    required_credentials:
      - WIND_API_KEY
    timeout_ms: 30000
    max_calls_per_run: 20
```

工具执行时必须经过 `tool-policy.ts`：

- 校验 skill 是否启用；
- 校验用户是否有权限；
- 校验 `server_type` 和 `tool_name` 是否在 allowlist 中；
- 使用 schema 校验参数；
- 为每次调用设置 timeout；
- 记录工具调用事件；
- 对错误进行结构化归因，而不是把 CLI stderr 直接暴露给前端；
- 对返回数据做大小限制和必要脱敏。

## T3 任务状态模型

建议在 Prisma 中新增以下模型或等价表结构。命名可按项目现有风格调整：

```prisma
model AgentRun {
  id              String          @id @default(cuid())
  userId          String?
  status          AgentRunStatus
  skillId         String
  title           String
  input           Json
  finalOutput     Json?
  errorCode       String?
  errorMessage    String?
  startedAt       DateTime?
  completedAt     DateTime?
  cancelledAt     DateTime?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  events          AgentRunEvent[]
  toolCalls       AgentToolCall[]
  artifacts       AgentArtifact[]
}

model AgentRunEvent {
  id          String   @id @default(cuid())
  runId       String
  sequence    Int
  type        String
  message     String?
  payload     Json?
  createdAt   DateTime @default(now())
  run         AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@unique([runId, sequence])
  @@index([runId, createdAt])
}

model AgentToolCall {
  id            String   @id @default(cuid())
  runId         String
  skillId       String
  serverType    String?
  toolName      String
  inputSummary  Json?
  outputSummary Json?
  status        String
  durationMs    Int?
  errorCode     String?
  createdAt     DateTime @default(now())
  run           AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, createdAt])
}

model AgentArtifact {
  id          String   @id @default(cuid())
  runId       String
  kind        String
  title       String
  contentType String
  uri         String?
  payload     Json?
  createdAt   DateTime @default(now())
  run         AgentRun @relation(fields: [runId], references: [id], onDelete: Cascade)
}

enum AgentRunStatus {
  queued
  running
  succeeded
  failed
  cancelled
}
```

注意事项：

- `AgentRun` 是 Web 侧的业务任务记录，不等同于容器内进程；
- `AgentRunEvent` 用于 UI 回放和 SSE 断线续传；
- `AgentToolCall` 是审计核心，应记录 tool 名称、耗时、状态、参数摘要和输出摘要；
- `AgentArtifact` 存放报告、引用、表格、图表等最终产物；
- 原始大数据不建议直接塞入 Prisma JSON，应存对象存储、文件存储或专门缓存，并在表中保存 uri。

## SSE 事件流设计

投研 agent 通常是长任务，前端不应等待一个同步 HTTP 响应。第一版建议使用 SSE：

```txt
GET /runs/:runId/events
```

事件类型建议：

```txt
run.created
run.started
agent.message
tool.call.started
tool.call.completed
tool.call.failed
artifact.created
run.succeeded
run.failed
run.cancelled
```

SSE payload 示例：

```txt
id: 42
event: tool.call.completed
data: {"runId":"run_123","toolName":"stock_data","durationMs":823,"summary":"获取 600519.SH 最近行情"}
```

推荐处理方式：

- `agent-runtime` 产生事件并写入自身事件缓冲；
- Web 侧在创建 run 后保存 `AgentRun`；
- Web 侧可以选择直接代理 `agent-runtime` 的 SSE，也可以由 `workflow-worker` 消费事件后落库，再由 Web 从数据库/Redis 推送；
- 第一版可以直接代理 SSE，随后补充落库；
- 每个事件带递增 `sequence`，前端断线后可用 `Last-Event-ID` 或 `afterSequence` 续传；
- 最终事件必须和 `AgentRun.status` 对齐，避免 UI 显示 running 但后端已失败。

前端页面第一版应至少包含：

- 新建 agent run 的表单；
- 可选 skill 列表；
- run 状态；
- 实时事件流；
- tool call 时间线；
- final report / artifact 展示；
- 取消按钮；
- 错误详情和重试入口。

## 风险清单

| 风险 | 影响 | 缓解策略 |
| --- | --- | --- |
| 运行时越权 | 读取敏感文件、执行非预期命令 | 独立容器、最小挂载、allowlist、禁任意 shell |
| 凭证泄露 | Wind / Tushare / LLM Key 泄露 | 凭证只在 runtime 注入，按用户或租户隔离，日志脱敏 |
| 数据授权违规 | 金融数据使用超范围 | 数据源标注、权限校验、用户协议、仅授权用户启用 |
| 额度失控 | 外部 API 成本不可控 | 调用预算、并发限制、每日额度、缓存 |
| 结果不可审计 | 投研结论无法追溯 | 记录输入、工具调用、数据来源、模型输出 |
| Prompt 注入 | 用户诱导 agent 违反边界 | 工具权限硬约束，系统提示只作为辅助，不作为唯一防线 |
| Skill 更新破坏行为 | 外部仓库变更导致行为漂移 | 固定 commit / release，更新前评审和回归测试 |

## 初步结论

Pi harness + 金融 skill 的方向值得推进，并且与 AlphaFlow 的产品定位匹配。但正确落点不是“把 Pi 和 wind-skills 直接 build in”，而是：

1. 把 Pi 作为独立 agent-runtime sidecar；
2. 把 skill 分为 prompt 型和 tool 型分别治理；
3. 通过 allowlist、审计、凭证隔离和预算控制降低风险；
4. 先做 `equity-investment-thesis` 类 prompt 型 POC；
5. 再小范围接入 Wind MCP 的只读工具能力；
6. 最后再考虑做可管理的投研 Skill 商店。

最推荐的第一步是：在公司研究页或工作流页增加一次可审计的 `equity-investment-thesis` POC，使用现有公司研究数据包生成结构化投资逻辑报告。这个 POC 能最快验证用户价值，同时避开工具型 skill 的权限和凭证复杂度。

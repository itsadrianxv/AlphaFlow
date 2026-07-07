# Pi Agent Harness 集成设计备忘录

## 背景

希望在应用中 build in [`earendil-works/pi`](https://github.com/earendil-works/pi) 这个 agent harness，使终端用户可以在 AlphaFlow 内使用诸如 [`Wind-Information-Co-Ltd/wind-skills`](https://github.com/Wind-Information-Co-Ltd/wind-skills) 这样的投研 skill。

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

### 5. 优先复用现有 Python 数据网关

并非所有金融数据都需要先走 Wind。AlphaFlow 已有 Python service，可以提供：

- A 股基础数据；
- 主题新闻；
- 候选股；
- 公司证据；
- 可信度分析；
- 缓存和降级能力。

建议 agent 工具路由优先使用内部数据网关，Wind 作为高质量补充数据源或授权用户的高级能力。

## 需要新增的核心概念

后续实现时可以考虑新增以下领域对象：

- `AgentRun`：一次 agent 执行；
- `AgentRunEvent`：流式事件、工具调用、状态变化；
- `SkillManifest`：已审核 skill 元信息；
- `SkillPermissionPolicy`：skill 权限策略；
- `ExternalCredentialBinding`：用户或租户级外部凭证绑定；
- `AgentToolCallAudit`：工具调用审计记录。

## 推荐目录结构

建议把 `agent-runtime` 作为独立的 Node/TypeScript sidecar，而不是放入 `python_services/`。

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

- 依赖 Pi 的核心包

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
- 限制单次任务超时、最大工具调用次数、最大 token、最大输出体积；
- 保存 tool call、参数摘要、错误、耗时和数据来源，支持后续审计。


## Docker Compose 与 Dockerfile 草案

`docker/docker-compose.yml` 中可以新增 `agent-runtime`：

同时在 `web` 和 `workflow-worker` 中增加：

```yaml
AGENT_RUNTIME_URL: ${AGENT_RUNTIME_URL:-http://agent-runtime:8020}
```

并在 `depends_on` 中依赖 `agent-runtime` 的 healthcheck。

`docker/agent-runtime/Dockerfile` 保持简单：


开发期需要热更新，请通过 compose 挂载 `../agent_runtime:/app/agent_runtime` 并运行 `npm run dev`。



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

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

# Spec #27：Ticket #33、#37、#40 修复 Handoff

## 审查范围

- 对比基准：`main`（`04cee4ce96468c5eb937302361368e6aabab32fb`）
- Ticket #33：分支 `agent/ticket-33-v04`，主提交 `a9aeea3d910814f23d122e25331e44d11e193fe1`
- Ticket #37：分支 `agent/ticket-37-v06`，主提交 `ac94da552b9fcbc7c525c4a1f8c1f59b01c1152e`
- Ticket #40：分支 `agent/ticket-40-v11`，主提交 `b7403c3b8f0a6227eecdddade5a000f62db0bcff`
- 权威规格：GitHub Issue #27；工程验收：Issue #33、#37、#40 及各自关闭评论
- 审查限制：仅做 Spec review；未做浏览器验证，未提交或关闭 Issue。

## 修复顺序

建议先修 P1-1、P1-2、P1-3，它们分别涉及不合规内容外泄、错误紧急提醒资格和三个 ticket 的生产可达性。随后补齐持久化、候选队列和确认绑定，再收紧模型契约与验收测试。

## Findings

### P1-1：#40 未过滤的模型原文会先经流式事件暴露

- Ticket：#40；Spec #27 §11，AC-26、AC-31。
- 文件/行：`agent_runtime/src/pi-adapter.ts`（`b7403c3`）206-242、731-765。
- 期望行为：所有同步、异步、Agent、Skill、定时任务及外部分发路径在用户可见前都由确定性 `research_only` 代码拦截。
- 实际缺口：`message_update` 和 `message_end` 先把原始模型文本写入 `agent.message.delta` / `agent.message`；最终 artifact 才调用 `enforceResearchOnlyFinalText`。订阅事件流的客户端可先看到买卖、仓位或价格内容。
- 建议修复：把增量输出先送入流式安全门控，只发布已结算片段；更稳妥的是服务端仅发布安全占位/结构化研究段，最终校验通过后再发布完整回答。不得继续保留可读取的原始用户事件。
- 建议验证：`cd agent_runtime; npm test -- --run tests/research-only-policy.test.ts`；新增 PiAdapter/event-stream 集成测试，断言 `agent.message.delta`、`agent.message`、artifact、scheduled result 均不含执行性内容。

### P1-2：#37 LLM 可以把弱传播升格为直接重点命中

- Ticket：#37；Spec #27 §7、§9，AC-18、AC-20。
- 文件/行：`web/server/application/research-assessment/research-assessment-service.ts`（`ac94da5`）254-300、516-523；`web/server/domain/research-preference/research-preference.ts`（分支依赖基底）178-200。
- 期望行为：对象关系、传播关系和重点资格完全由结构化确定性关系决定；弱传播永不继承重点关注，也不能取得公司级紧急提醒资格。
- 实际缺口：服务先计算 `deterministicMatches`，却只把它放入模型提示；结算时改用 LLM 返回的 `matchedPreferences`。校验只检查 schema 和引用闭合，未核对 relation/path。模型可把 `WEAK` 返回成 `DIRECT`，随后 `resolvePreferenceMatches` 会保留 `FOCUS` 并令 `directFocusMatch=true`。
- 建议修复：从确定性 matches 生成最终 `matchedPreferences`、relation、path 和 focus 资格；LLM 只返回相关性分数、依据、引用和不确定性。若保留模型匹配字段，必须与确定性集合逐项完全闭合，否则整次相关性评估失败。
- 建议验证：`cd web; npm test -- --run tests/research-assessment-contract.test.ts`；新增 `WEAK -> DIRECT`、伪造 path、无匹配强行命中、重点关注弱传播四组对抗样例。

### P1-3：#33 交付的是静态决策原型，不是生产 application/UI contract

- Ticket：#33；Spec #27 §2、§5、§13，AC-01、AC-02、AC-10、AC-31。
- 文件/行：`web/contracts/professional-market-baseline.ts`（`a9aeea3`）639-666；`web/app/market-context/prototype/market-baseline-prototype.tsx` 619-637、1326-1354；`web/app/market-context/prototype/page.tsx` 6-12。
- 期望行为：统一研究工作台读取 V03 生成的真实不可变首页快照，在最高 application/UI seam 表达四阶段六域、旧当前快照回退、可选缺口和必需数据门控。
- 实际缺口：唯一消费者是明确标注“不是生产页面”的 prototype；页面直接读取固定日期 mock 常量，仓库没有生产 application service/router/page 使用该 contract。真实快照、用户隔离、投影和回退逻辑均不可达。
- 建议修复：在首页 application module 内从 `HomePageSnapshot` 读取信封投影出版本化专业市场基线 read model；生产页面只消费该接口。保留 mock 作为测试 adapter/fixture，不作为生产 contract 实例。
- 建议验证：`cd web; npm test -- --run tests/professional-market-baseline.test.ts tests/home-page-snapshot-service.test.ts tests/home-page-generation.test.ts`；新增最高 application caller 与服务端渲染结构测试，不做浏览器验证。

### P1-4：#40 候选种子没有真正异步入队或持久化

- Ticket：#40；Spec #27 §11，AC-25。
- 文件/行：`agent_runtime/src/research-only-policy.ts`（`b7403c3`）121-151；`agent_runtime/src/pi-adapter.ts` 737-780；`agent_runtime/src/run-store.ts` 11-18。
- 期望行为：即时研究响应完成后，新网页证据以幂等身份异步形成候选种子，不同步写研究事件、收件箱或分发状态。
- 实际缺口：代码只构造带 `targetStores` 文案的对象，并写入内存 run event/audit；没有 queue、repository 或 HTTP adapter 调用，也没有消费者。运行清理或进程重启后对象消失。
- 建议修复：定义窄的 candidate-seed enqueue port，生产 adapter 调用 Web/PostgreSQL 权威幂等写入并发出至少一次唤醒；响应提交后调用该 port。以稳定材料身份而非仅 runId 生成幂等键，重复回灌返回同一种子。
- 建议验证：新增 Agent Runtime 到 Web candidate repository 的 contract/integration test，覆盖响应先完成、重复 enqueue、进程重试、不得同步生成事件/收件箱/分发状态。

### P1-5：#37 评估与雷达没有生产调用，默认状态仅驻留内存

- Ticket：#37；Spec #27 §7-§9、§13，AC-15、AC-17、AC-20、AC-32。
- 文件/行：`web/server/application/research-assessment/research-assessment-service.ts`（`ac94da5`）124-204、206-367；`web/prisma/schema.prisma`（分支）1931-1973。
- 期望行为：已结算事件修订触发全局/逐用户评估，结果、冻结输入、版本、用量和旧有效投影持久化；生产读取可得到独立雷达。
- 实际缺口：`ResearchAssessmentService` 与 DeepSeek adapter 仅被测试引用，未接入事件结算、任务、router 或首页读取；默认 store 是 `Map`。Prisma 已有评估表但未使用，缓存、审计和旧评估重启即丢失。
- 建议修复：抽出 repository port，实现 PostgreSQL adapter；由确定性任务/controller 在事件修订结算后调度评估；增加最高 application seam 读取基线和用户雷达。事务内保存输入快照、版本、输出、usage 与当前有效投影。
- 建议验证：`cd web; npm test -- --run tests/research-assessment-contract.test.ts`；新增 PostgreSQL repository contract、事件结算到评估任务、雷达 application caller 测试。

### P1-6：#40 二次确认只绑定 intentId，可在确认后替换精确影响

- Ticket：#40（依赖 V10 的本票验收范围 AC-27）；Spec #27 §11，AC-27。
- 文件/行：`web/server/application/agent-runtime/deterministic-controller.ts`（`b7403c3`）197-220；`web/tests/agent-deterministic-controller.test.ts` 44-91。
- 期望行为：用户确认必须绑定此前展示的完整精确影响；对象、批量、渠道、payload 或副作用任一变化都必须重新确认。
- 实际缺口：Controller 只比较 agent 可控的 `intentId` 与布尔值。现有测试甚至在确认调用中移除了首次展示的 `SEND_EXTERNAL_COPY` sideEffect，但仍断言成功。
- 建议修复：对规范化 intent/preciseImpact、actor、run 和过期时间生成服务端 confirmation token/hash；结算时重新计算并常量时间比对。payload 改变即返回新的 `NEEDS_CONFIRMATION`。
- 建议验证：`cd web; npm test -- --run tests/agent-deterministic-controller.test.ts`；增加改 intentType、对象、数量、渠道、proposedWrite、sideEffect、过期/跨用户 token 的拒绝矩阵。

### P2-1：#33 回退/覆盖/信息域行为只由文案和弱断言模拟

- Ticket：#33；Spec #27 §2、§5、§13，AC-01、AC-02、AC-10。
- 文件/行：`web/contracts/professional-market-baseline.ts`（`a9aeea3`）30-52、639-666；`web/tests/professional-market-baseline.test.ts` 22-49、51-88、91-104；prototype 1334-1354。
- 期望行为：必需数据不达标时不产生新快照并返回上一份当前快照；可选失败才产生受限新快照。图表、正文和证据共享可验证的 coverage identity；域切换产生真实视图行为但不改变底层基线集合/排序。
- 实际缺口：整体状态恒为 `CURRENT_READY_WITH_LIMITATION`，同时包含 `requiredDataReady:false` 的必需项；没有 previous snapshot identity/选择逻辑。item 没有 coverageId，图表只用字符串前缀；测试中的 `item.asOf || chart.actualDataCutoff` 恒真。`activeDomain` 不参与 `visibleItems`，域按钮只改标签。
- 建议修复：让 application read model 显式携带 served/current/attempted snapshot、fallback reason 和共享 coverage；把域选择建模为派生视图，底层排序保持不变。测试真实状态转换和渲染树，不读取源码字符串。
- 建议验证：沿用 #33 命令，并新增 required-failure、optional-failure、phase/domain selection、共享 coverage、证据入口与 per-region cutoff 的 table tests。

### P2-2：#37 缓存与旧有效评估身份不符合不可变修订语义

- Ticket：#37；Spec #27 §7、§8、§13，AC-17、AC-32。
- 文件/行：`web/server/application/research-assessment/research-assessment-service.ts`（`ac94da5`）19-27、124-178、206-245、268-320、439-467。
- 期望行为：缓存身份包含冻结输入、模型参数、prompt、schema 和校验规则版本；新修订失败时保留同一事件上一有效修订的评估供降级读取。
- 实际缺口：hash 未包含已定义的 prompt/schema/validation 版本；旧评估仅按同一个 `eventRevisionId` 查找。测试通过“修改内容但复用 revisionId”模拟旧值，违背不可变修订；真实 revision-2 失败无法回退 revision-1。
- 建议修复：缓存 identity 纳入全部版本；repository 同时维护不可变 assessment 和按 eventKey/user 的当前有效投影。失败不覆盖投影，新修订成功后原子推进。
- 建议验证：增加版本升级 cache miss、revision-2 失败保留 revision-1、成功后推进、并发晚完成不倒退测试。

### P2-3：#37 模型输入、凭据池和输出契约缺少规格约束

- Ticket：#37；Spec #27 §7、§8，AC-15、AC-17、AC-32。
- 文件/行：`web/contracts/research-assessment.ts`（`ac94da5`）13-62；`web/server/application/research-assessment/research-assessment-service.ts` 31-64、370-445、448-549；`web/server/infrastructure/research-assessment/deepseek-research-assessment-adapter.ts` 38-49、70-125；`web/contracts/research-preference.ts`（分支）39-50。
- 期望行为：冻结输入不含无关用户身份；执行 32K/8K 确定性裁剪并记录省略；引用 ID 与 refType、所需双边引用都闭合；证据资格、冲突和结构化不确定性可审计；同账号多 Key 只轮换，独立账号才算独立池；网络/429/5xx 按策略重试。
- 实际缺口：相关性输入发送完整 preference snapshot（含 userId）；maxInputTokens 仅是元数据，没有计量/裁剪/省略记录。refType 不与对象类型核验，也未实现双边引用；冻结证据缺资格/冲突字段，不确定性只是字符串。每个 key 被当作独立 credential，adapter 无生产测试；网络错误直接退出。
- 建议修复：引入最小化 frozen DTO 和确定性 token budgeter；扩充引用索引与契约校验；凭据配置显式 accountId/keyId 分组并接入资源许可/重试分类。禁止用结构修复循环代替网络重试。
- 建议验证：扩展 20+20 固定机器样例，覆盖 refType 错配、双边引用、合法 null、超长裁剪、userId 不外发、同账号多 Key、独立账号切换、429/5xx/timeout、修复最多一次。

### P2-4：#37 雷达候选集合被错误限制为基线固定容量

- Ticket：#37；Spec #27 §9，AC-20。
- 文件/行：`web/server/application/research-assessment/research-assessment-service.ts`（`ac94da5`）323-367。
- 期望行为：专业市场基线集合/排序原样返回；个性化雷达从独立的相关事件候选集合增强，不能只复制基线已有事件。
- 实际缺口：`radarItems` 仅通过 `baselineEvents.map` 生成。与用户高度相关但未进入全局基线固定容量的事件永远无法出现在雷达。
- 建议修复：接口分别接收 immutable baseline projection 与 eligible personalized revisions；雷达按相关性排序独立组装，绝不写回 baseline。
- 建议验证：加入“事件不在基线但直接命中关注”应进入雷达，以及无关注时 baseline 完整、radar 为空的测试。

### P2-5：#40 research_only 与公开网页边界的固定验收矩阵不足

- Ticket：#40；Spec #27 §11，AC-25、AC-26、AC-31。
- 文件/行：`agent_runtime/src/research-only-policy.ts`（`b7403c3`）3-15、52-96；`web/server/application/agent-runtime/research-only-policy.ts` 1-46；`agent_runtime/src/tool-policy.ts` 51-109；`agent_runtime/tests/research-only-policy.test.ts` 1-88。
- 期望行为：直接、间接、结构化、附件、Skill、定时和外部路径都拒绝执行性内容；拒绝后仍有事实、证据、正反情景、风险、判断条件和验证项；公开网页不能访问本机、内网或链路本地地址。
- 实际缺口：有限 regex 与逐行删除容易漏掉 snake_case 字段、英文/中文同义表达和跨行组合；只要保留任意一行就不会补齐六类研究内容。URL 检查只比较字面 hostname，IPv6 hostname 带方括号时可绕过，且缺 DNS/重定向边界。现有测试只有少量直接样例。
- 建议修复：以严格结构化回答 schema 和统一输出结算器为主，词表只做前置检测；Controller 对规范化字段语义判定。URL adapter 在实际请求边界校验解析后的 IP，并对每次重定向复检。
- 建议验证：扩展固定对抗矩阵，至少覆盖流式、附件、Skill、定时、外部分发、snake_case/嵌套字段、跨行、中英同义、IPv6/IPv4-mapped、DNS 解析和重定向。

## 总体验证建议

```powershell
Set-Location web
npm test -- --run tests/professional-market-baseline.test.ts tests/home-page-snapshot-service.test.ts tests/home-page-generation.test.ts
npm test -- --run tests/research-assessment-contract.test.ts
npm test -- --run tests/agent-deterministic-controller.test.ts
npm run typecheck

Set-Location ../agent_runtime
npm test -- --run tests/research-only-policy.test.ts tests/execution-boundary.test.ts
npm run typecheck
```

新增 PostgreSQL contract/integration tests 后，还应使用项目既有测试数据库环境执行相应测试。不要进行浏览器验证。

## 后续 Agent 工作边界

- 先读取 `AGENTS.md`、`docs/agents/issue-tracker.md`、Issue #27/#33/#37/#40 和本文件。
- 不关闭或改写 GitHub Issue，除非用户另行授权。
- 当前三个工程分支携带不同依赖提交；先建立明确的集成基底，避免把依赖 ticket 的改动误删或重复实现。
- 工作区可能已有用户未提交改动，必须保留并在隔离 worktree 中实施。
- 所有中文文件显式使用 UTF-8；Web 测试统一放在 `web/tests`；不做浏览器验证。

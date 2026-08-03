# Spec #27：Ticket #38、#39 修复 Handoff

## 审查范围

- 对比基准：`main`（`04cee4ce96468c5eb937302361368e6aabab32fb`）
- Ticket #38：分支 `agent/ticket-38-v08`，主提交 `63de6a8dd0bc47e82a7aeedecd6c461527120709`
- Ticket #39：分支 `agent/ticket-39-v09`，主提交 `b757315ccaa6fbb71f2555d9c4728c8c68d618e4`
- 规范来源：GitHub Issue #27；工程验收：Issue #38、#39 及关闭评论
- 审查限制：仅 Spec review；未修改代码、未提交或关闭 issue，未做浏览器验证。

## 修复顺序

先修 #39 的生产接入、许可释放和投递并发一致性，再修 #38 的用户域幂等与证据/修订链路；最后补齐简报冻结输入、死链接、配置阻断和 PostgreSQL contract 覆盖。

## Findings

### P1-1：#39 分发/简报/Feishu 只有孤立 application seam，未接入生产链路

- 文件/行：`web/server/application/research-distribution/research-distribution-service.ts:216-365,500-513`；`web/tooling/workers/scheduled-task-scheduler.ts:141-185,320+`。
- 期望行为：已结算事件应经确定性门控写入收件箱；交易日 08:50、16:45、22:50 创建并发布简报；Feishu 副本进入可重试 worker。对应 Spec §10、AC-16、AC-22、AC-23。
- 实际缺口：仓库搜索显示 `ResearchDistributionService`、`publishBriefing` 和 `briefingScheduleForTradingDay` 只有测试调用；scheduler 仍只处理既有 ScheduledTask/Homepage/旧 Feishu delivery。运行时不会消费事件、创建 briefing scope、写入收件箱或发送新副本。
- 建议修复：在事件/评估结算后的 Deterministic Controller 中接入 `distribute`；把三时点任务持久化为 `ResearchTask`/调度任务并调用 `freezeBriefingScope`、`publishBriefing`；新增 due-copy 查询与 retry worker，避免仅靠手动 `retryFeishuCopy`。
- 建议验证：`git grep -n "ResearchDistributionService\|publishBriefing\|briefingScheduleForTradingDay" agent/ticket-39-v09 -- ':!web/tests/*'`；新增事件结算→收件箱→Feishu、三时点调度和晚间静默的 application/integration contract test。

### P1-2：#39 Feishu 许可获取后从未释放，持续占用资源池

- 文件/行：`web/server/infrastructure/research-distribution/postgres-feishu-delivery-guard.ts:22-65`。
- 期望行为：每次外部投递在 PostgreSQL 许可内执行，完成、失败或退避后释放 permit；Spec §12、AC-29。
- 实际缺口：`acquireNestedPermit` 返回 permit 后只调用 `recordOutcome`，成功和异常路径都没有 `releasePermit`。许可只能等 lease 过期，连续投递会耗尽 Feishu 资源池并触发误判的不可用/熔断。
- 建议修复：保存返回的 permit，使用 `try/finally` 按 holder/fencing 调用 `releasePermit`；将释放结果纳入审计，旧 fencing 释放失败必须保留为 lease lost。
- 建议验证：新增 guard contract，断言 success、HTTP 失败、`LeaseLostError`、permit unavailable 都释放或明确不持有 permit；运行 PostgreSQL scheduler permit 竞争测试。

### P1-3：#39 Feishu 副本没有 claim/CAS/fencing，并发重试可重复发送

- 文件/行：`web/server/application/research-distribution/research-distribution-service.ts:258-262,393-497`；`web/server/infrastructure/research-distribution/prisma-research-distribution-store.ts:80-94`；`web/server/infrastructure/research-distribution/feishu-webhook-delivery-adapter.ts:14-31`。
- 期望行为：同一副本恢复/重试按幂等语义至多由一个 worker 执行；站内记录不回滚，外部发送状态按 fencing/CAS 单调推进。对应 Spec §10、§12、AC-23、AC-29。
- 实际缺口：`retryFeishuCopy` 先读状态再无条件调用 Webhook，`saveCopy` 是无条件 `UPDATE`，没有 `SENDING` claim 或版本条件；两个 worker 可同时发送，旧失败结果还能覆盖新 `SENT`。Webhook 请求也未携带可供外部去重的 idempotency key。
- 建议修复：增加 `claimCopy(copyId, holderId, fencingToken)` 与条件状态迁移（`PENDING/RETRY_WAIT -> SENDING -> SENT/RETRY_WAIT`），发送前后校验 lease；请求体携带稳定幂等键，或明确 adapter 的去重协议；熔断读改写使用行锁/版本 CAS。
- 建议验证：新增双 worker 并发发送、成功后迟到失败、重启接管、同 key 重放和外部幂等测试；PostgreSQL contract 必须在真实数据库运行而非仅检查单次建档。

### P1-4：#39 简报草稿未绑定冻结候选内容或偏好快照

- 文件/行：`web/server/application/research-distribution/research-distribution-service.ts:60-74,264-320,322-365`。
- 期望行为：候选范围、必显更正/撤回、渠道、容量和收件箱提交顺序由确定性代码冻结；Agent 只能在冻结集合内组织叙事，偏好变化不回查在途内容。对应 Spec §10 258-261、AC-22、AC-23。
- 实际缺口：`BriefingScope` 只保存 ID，不保存候选正文、输入 hash、revision 或 preference snapshot identity；`validateBriefingDraft` 只比较 `includedIds`。调用方可以提交任意标题、摘要和 body，添加冻结集合之外的事实，或用同一用户的另一份偏好快照重新决定是否发布。
- 建议修复：冻结规范化候选 payload、事实/证据引用、容量和偏好快照 hash；草稿结算校验 payload hash、必显项和引用闭合，并把 scope 与 task/input hash 持久化。发布只使用冻结的 channel decision，不重新读取当前偏好。
- 建议验证：新增“改标题/body/事实/证据/偏好版本即拒绝”以及“冻结后关闭渠道仍按冻结结果处理”的 application contract test。

### P1-5：#38/#39 分发幂等键没有用户域，可能跨用户返回错误收件箱记录

- 文件/行：`web/prisma/schema.prisma:1976-2009`；`web/server/infrastructure/research-inbox/prisma-research-inbox-repository.ts:27-35,68-73`；`web/server/domain/research-inbox/repository.ts:35-50`。
- 期望行为：每位用户按自己的偏好快照获得一条同一门控结果的权威记录，并保留该用户的最高渠道；Spec §7、§9、§10 255，AC-21。
- 实际缺口：`distributionKey` 是全局 `@unique`，去重只按 key，命中后不比较 `userId`。若两个用户复用同一事件 key，后者会得到前者的 entry；同一 key 先以 `IN_APP` 建档、后以更高渠道重放也直接返回旧记录，不会合并最高渠道。
- 建议修复：将幂等边界改为 `(userId, distributionKey)`，或在 service 生成并强制包含 user scope；在事务内按渠道优先级合并/拒绝冲突，严禁跨用户返回 entry。
- 建议验证：跨用户同 key、同用户不同渠道并发、错误 userId 重放、Feishu copy 绑定用户的 application/PG contract test。

### P1-6：#38 收件箱不要求评估引用与事实主张的证据闭合

- 文件/行：`web/server/domain/research-inbox/types.ts:88-102`；`web/server/application/research-inbox/research-inbox-service.ts:79-100`；`web/contracts/research-inbox.ts:29-98`。
- 期望行为：收件箱记录保留全局/相关性评估、冻结偏好和证据引用；正文中的事实主张与研究含义可追溯。对应 Issue #38 AC、Spec §10 252-253、AC-21。
- 实际缺口：三个评估/偏好引用字段都是可选，服务只校验主体数量和简报主体一致性；`facts`、`impact`、`reasons` 只是字符串，没有 claim→evidence ID 关系。可存储带四维评分但无任何评估引用、或无法闭合到本次输入的正文。
- 建议修复：按 entry kind 要求必需引用；引入 claim/citation 结构或复用事件 claim/citation 契约，验证引用属于同一 revision/candidate/preference snapshot 和用户。
- 建议验证：缺失引用、跨事件引用、跨用户引用、claim 无 citation、合法 null 评估的拒绝/通过矩阵。

### P2-1：#38 更正/撤回没有由模块保证新通知和旧记录链路

- 文件/行：`web/server/application/research-inbox/research-inbox-service.ts:79-100`；`web/server/domain/research-inbox/types.ts:39-45`；`web/server/infrastructure/research-inbox/prisma-research-inbox-repository.ts:27-35`。
- 期望行为：更正/撤回生成新站内通知，旧正文不覆盖，并能展开前后修订链。对应 Issue #38 AC、Spec §10 255、AC-21。
- 实际缺口：`CORRECTION`/`RETRACTION` 只是枚举；没有 `supersedesRevisionId`/`supersedesEntryId` 约束，`revisions` 是自由 JSON 数组。复用旧 key 时仓储直接返回旧正文，模块没有保证新通知。
- 建议修复：增加明确的 supersedes 关系和新 revision/distribution key 约束；更正/撤回只能插入新 entry，历史读取保留旧 entry 并展示链路。
- 建议验证：原事件→更正→撤回的 application/PG contract，断言三条记录、旧正文不变、关系可展开、重复更正幂等。

### P2-2：#39 Feishu 默认收件箱链接指向不存在的路由

- 文件/行：`web/server/application/research-distribution/research-distribution-service.ts:383-387`；`web/app/research-inbox/page.tsx:1-7`。
- 期望行为：Feishu 副本包含可打开的站内链接（Spec §10 260、AC-23）。
- 实际缺口：默认生成 `/research/inbox/<id>`，实际页面路由是 `/research-inbox`；只有单测显式注入 `inboxLink`，默认路径未覆盖，真实副本会收到 404 链接。
- 建议修复：统一使用路由常量/绝对 public base URL，并在默认 adapter 路径测试链接可解析。
- 建议验证：不注入 `inboxLink` 的 Feishu payload test，断言链接与生产页面路由一致。

### P2-3：#39 Feishu 配置错误被误分类为可重试网络错误

- 文件/行：`web/server/infrastructure/research-distribution/feishu-webhook-delivery-adapter.ts:14-35`；`web/server/domain/scheduled-task/delivery-targets.ts:76-97`。
- 期望行为：鉴权、配置和 contract 不兼容进入配置阻断，不自动半开/重试；Spec §12 289、AC-23/30。
- 实际缺口：`resolveFeishuWebhook` 抛出的 target/secret/URL 配置错误也被 adapter 的 catch 转成 `FEISHU_NETWORK_ERROR`（retryable=true），会错误消耗 5 次/30 分钟预算并参与熔断。
- 建议修复：在 resolve 阶段保留结构化 configuration error，映射为 `CONFIG_BLOCKED`；只有 fetch 网络异常和明确 HTTP 429/5xx 才进入重试。
- 建议验证：缺 target、缺 secret、非法 URL、HTTP 429/503、业务错误的分类矩阵；断言配置错误不创建重试时间表。

## 测试与环境缺口

- Issue #38 关闭评论明确 PostgreSQL contract 因业务库未初始化未实际运行；`web/tests/research-inbox.postgres.test.ts:8-10` 在缺少 `RESEARCH_POSTGRES_CONTRACT_URL` 时直接 skip。
- Issue #39 关闭评论明确 PostgreSQL contract 1 项因未设置 `RESEARCH_POSTGRES_CONTRACT_URL` 跳过；`web/tests/research-distribution.postgres.test.ts:6-7` 同样可被 skip。
- 现有单测没有覆盖生产调用链、跨用户 key、不同渠道并发、permit release、Feishu copy claim/CAS、简报 payload/hash、配置阻断和默认链接。
- 建议命令（进入 `web` 目录）：

```powershell
npm test -- --run tests/research-inbox.test.ts tests/research-inbox-route.test.ts
npm test -- --run tests/research-distribution.test.ts tests/research-feishu-adapter.test.ts
npm run typecheck
```

配置真实 PostgreSQL 后再运行：

```powershell
$env:RESEARCH_POSTGRES_CONTRACT_URL = "<contract-db-url>"
npm test -- --run tests/research-inbox.postgres.test.ts tests/research-distribution.postgres.test.ts
```

不要用“未设置环境变量导致 skip”作为验收通过；新增生产接线与多 worker contract 后必须在 PostgreSQL 环境执行。

## 后续 Agent 边界

- 先读取 `AGENTS.md`、`docs/agents/issue-tracker.md`、Issue #27/#38/#39 和本 handoff。
- 只修复上述 Spec 缺口，不关闭或改写 GitHub Issue，除非另有授权；保留工作区已有用户改动。
- 所有中文文件显式使用 UTF-8；Web 测试放在 `web/tests`；不做浏览器验证。

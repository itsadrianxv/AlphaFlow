# 投研网站证券投资建议合规观察与整改建议

> 文档性质：工程侧合规风险记录，不构成法律意见，也不能替代向中国证监会派出机构、市场监管部门或专业律师进行的正式咨询。
>
> 检查日期：2026-07-29
>
> 检查方式：基于当前代码和配置静态检查，未进行浏览器验证。项目尚未部署，数据库中的数据按项目说明均为 mock 测试数据。

## 一、结论摘要

当前项目已经超出“只展示公开市场数据”的普通研究工具形态，存在被理解为面向特定用户提供个性化证券投资建议或交易决策辅助的明显风险。风险主要来自产品的实际功能组合，而不是页面上是否写了一句免责声明：

1. 读取用户的总资产、现金、持仓、成本、仓位、计划持有天数和风险偏好。
2. 针对个股生成“试仓、建仓、加仓、持有、减仓、卖出”等动作。
3. 进一步给出建议仓位、入场区间、追价上限、失效价、止损价和分批执行方案。
4. Agent Runtime 对用户开放了交易计划、仓位、止损止盈和突破执行类技能。
5. 系统保存实际收益、基准收益、超额收益、胜率或回撤类复盘结果；如果这些结果用于公开宣传，可能形成业绩展示或误导性宣传风险。

因此，在中国大陆进行备案和市场测试时，建议先把公开版本明确收敛为 `research_only`（仅研究）模式：提供数据、证据、研究观点、待验证条件和风险提示，不针对用户个人情况给出可执行的买卖、仓位或价格指令。ICP备案本身不等于取得证券投资咨询业务资质；备案通过也不会替代其他金融监管要求。

## 二、当前代码中的高风险功能

### 1. 用户画像和组合数据具有明显个性化特征

项目保存并使用以下信息：

- `cash`、`totalCapital`：现金和总资产；
- `positions`：股票代码、数量、成本价、当前仓位、行业、主题、建仓日期、最近加仓日期等；
- `riskPreferences`：单票上限、主题暴露、试仓比例、组合风险预算；
- `plannedHoldingDays`、`invalidationPrice`：计划持有天数和失效价。

主要证据：

- `web/prisma/schema.prisma:962` 的 `PortfolioSnapshot`；
- `web/app/timing/timing-wizard-view-models.ts:318` 及其后的组合输入校验；
- `web/server/domain/timing/types.ts:757` 的 `PortfolioPosition`、`PortfolioRiskPreferences` 和 `PortfolioSnapshotDraft`。

这些字段不是一般的匿名行情筛选参数，而是把输出绑定到特定用户的资金、持仓和风险承受能力上。即使输出采用“仅供参考”措辞，个性化程度仍然是主要风险来源。

### 2. 时机分析直接生成交易动作

时机领域定义了以下动作：

```text
WATCH / PROBE / ENTER / ADD / HOLD / TRIM / EXIT
观望 / 试仓 / 建仓 / 加仓 / 持有 / 减仓 / 卖出
```

主要证据：

- `web/server/domain/timing/types.ts:9` 的 `TIMING_ACTIONS`；
- `web/app/timing/timing-labels.ts:15` 和 `web/app/timing/timing-signal-card-list.tsx:46` 的动作展示；
- `web/server/application/timing/timing-analysis-service.ts:21`、`timing-rule-analysis-service.ts:14` 的动作映射。

其中 `HOLD` 也属于针对已有持仓的决策，不应因为它不是“买入”就视为没有建议风险。研究模式应避免向用户返回这些面向个人的交易动作，统一改成“研究对象、观察状态或待验证条件”等非执行性结论。

### 3. 执行计划包含价格、仓位和动作顺序

`TimingExecutionPlanService` 会根据推荐结果生成：

- 建议仓位下沿和上沿；
- 目标仓位变化、可用现金比例、单票上限和组合风险预算；
- 参考价、入场区间、追价上限、止损/失效价；
- 试仓、加仓、减仓、退出和持有的分批方案；
- “允许执行”或“暂不执行”的结果。

主要证据：

- `web/server/application/timing/timing-execution-plan-service.ts:137` 的分批计划；
- `web/server/application/timing/timing-execution-plan-service.ts:204` 的决策、仓位预算和订单计划；
- `web/app/timing/reports/[cardId]/timing-report-view.tsx:326` 的“执行结论”和“仓位预算”展示；
- 同一页面后续的“订单计划”面板。

这类输出已经非常接近“何时做、做多少、以什么价格做、什么条件退出”的完整执行方案，是当前最需要从公开版本移除的部分。工程上不能只在前端隐藏面板，服务端仍返回这些字段同样存在风险。

### 4. Agent Runtime 开放了交易决策类技能

`agent_runtime/src/skill-registry.ts:78` 起的“交易计划与仓位风控”分类中，至少包含：

- `trade_plan_builder_skill`；
- `premarket_trade_checklist_skill`；
- `breakout_trade_execution_skill`；
- `dip_buy_decision_skill`；
- `position-sizer`、`position_sizing_decision_skill`；
- `stop_loss_discipline_skill`；
- `take_profit_ladder_skill`；
- `trim_or_hold_decision_skill`；
- `add_to_winner_decision_skill`；
- `failed_breakout_exit_skill`；
- `backtest-expert`。

其中多个 Skill 的描述和正文直接出现“买卖计划、仓位大小、下单前、止损、止盈、加仓、减仓、撤退”等执行语义。例如：

- `agent_runtime/skills/trade_plan_builder_skill/SKILL.md`：生成入场条件、仓位安排、止损止盈和应急动作的完整执行计划；
- `agent_runtime/skills/position_sizing_decision_skill/SKILL.md`：根据风险预算和组合承受力给出仓位大小与分批节奏；
- `agent_runtime/skills/stop_loss_discipline_skill/SKILL.md`：设计价格止损并给出触发后的执行动作；
- `agent_runtime/skills/take_profit_ladder_skill/SKILL.md`：设计分批卖出梯度；
- `agent_runtime/skills/add_to_winner_decision_skill/SKILL.md`、`trim_or_hold_decision_skill/SKILL.md`、`failed_breakout_exit_skill/SKILL.md`：分别处理加仓、减仓/持有和突破失败后的退出。

公开版本应从服务端用户可选 Skill 白名单中移除这些能力，而不是只删除前端菜单。`premarket_trade_checklist_skill`、`dip_buy_decision_skill` 和 `position-sizer` 也应一并禁用；`backtest-expert` 若仍保留，只能用于内部方法验证，不能生成面向用户的交易结论或业绩承诺。

### 5. 仅靠系统提示词不足以形成可靠拦截

`agent_runtime/src/pi-adapter.ts:102` 的系统提示词包含“不得输出买卖建议、收益保证或确定性投资承诺”，这是有益的行为约束，但不能作为唯一控制措施，原因包括：

- 用户仍可能直接选择交易类 Skill；
- Skill 正文与用户提示可能要求生成交易计划；
- 当前是流式输出，模型文本可能在拦截前已经发送给前端；
- 仅限制模型措辞，不能阻止时机服务或其他 API 直接返回结构化仓位和价格字段；
- 同样的能力可能通过定时任务、工作流或内部路由绕过前端入口。

必须在 API、应用服务/领域服务、Agent Skill 白名单、输出校验和定时任务交付链路同时实施服务端限制。

### 6. 复盘和业绩数据存在宣传风险

`web/prisma/schema.prisma:1034` 的 `TimingReviewRecord` 保存：

- 实际收益、基准收益和超额收益；
- 最大有利/不利波动；
- 预期动作、实际结果、结论和执行偏差。

这些字段对内部研发和模型评估有价值，但公开展示“命中率、胜率、超额收益、最大回撤”等指标时，应同时说明样本、时间区间、基准、交易成本、滑点、停牌/涨跌停处理、幸存者偏差、回测与实盘的区别以及不代表未来表现。市场测试阶段建议默认仅供内部评估，不做“高胜率”“稳定盈利”“跑赢市场”等宣传。

### 7. 当前发现的有利条件和缺口

有利条件：

- 未发现证券账户开户、券商账户绑定或自动下单接口；
- 未发现支付、会员收费或明显的荐股收费闭环；
- 当前项目尚未部署，数据库数据为 mock，整改的技术成本和数据迁移压力较小。

仍需补齐的公开运营基础页面和机制：

- 隐私政策；
- 用户协议；
- 独立、易见的风险揭示；
- 数据来源、数据日期、许可和免责声明说明；
- 联系方式、投诉/反馈入口；
- 个人信息查询、更正、删除、注销和留存期限说明；
- Agent 生成内容的来源、时间戳、版本和不确定性说明。

这些页面不能替代证券投资咨询资质，但缺失会增加备案、上线审核和用户纠纷风险。

## 三、建议的整改方案

### A. 先落地默认开启的 `research_only` 模式

公开部署的默认配置应为仅研究模式，并在服务端强制执行。建议的输出契约如下：

```json
{
  "mode": "research_only",
  "subject": "研究对象",
  "conclusion": "研究结论或观察状态",
  "evidence": [],
  "validationConditions": [],
  "risks": [],
  "dataAsOf": "数据日期",
  "sourceCitations": []
}
```

公开输出可以回答“发生了什么、证据是什么、哪些条件仍需验证、主要风险是什么”，但不要回答“你应买多少、何时买、何时卖、跌到哪里止损”。

### B. 统一禁止交易型字段和动作

在研究模式中：

1. 禁止生成或返回 `ENTER`、`ADD`、`TRIM`、`EXIT`、`PROBE`、`HOLD` 等针对个人的交易动作；建议新增 `RESEARCH` 或等价的研究状态。
2. 禁止返回 `suggestedMinPct`、`suggestedMaxPct`、`riskBudgetPct`、`targetDeltaPct` 等个性化仓位字段。
3. 禁止返回 `entryZoneLow`、`entryZoneHigh`、`chaseLimitPrice`、`stopPrice` 和 `splitPlan`。
4. 禁止返回或展示“允许执行”“订单计划”“执行价位”等交易执行语义。
5. 禁止在研究模式创建 `TimingExecutionRecord`，也不能由定时任务交付交易动作。
6. 对用户输入侧，公开版本不主动采集总资产、可用现金、持仓数量、成本价、个人风险偏好等非必要信息；已有内部测试表可以保留，但不得由公开接口读取并用于个性化输出。

### C. 在多层服务端控制，而不是只改 UI

整改至少应覆盖以下边界：

- `web/server/api/routers/timing.ts`：拒绝交易动作、执行计划和执行记录相关公开请求；
- `web/server/application/timing/timing-analysis-service.ts`、`timing-report-service.ts`、`timing-execution-plan-service.ts`：从服务层阻断交易型结果，避免绕过路由直接调用；
- `web/server/api/routers/agent-runtime.ts` 和 Agent Runtime：限制 Skill ID、请求参数和上下文；
- `agent_runtime/src/skill-registry.ts`：建立面向公开用户的研究 Skill 白名单；
- `agent_runtime/src/pi-adapter.ts` 及流式输出处理：采用结构化结果校验，必要时先缓冲后发送，不能只依赖 prompt；
- 工作流和定时任务创建、执行、通知链路：禁止保存或发送交易计划、仓位和价格指令。

建议把合规模式做成单一的服务端策略对象，所有上述入口调用同一策略，避免用多个环境变量和分散的字符串判断造成漏拦截。客户端隐藏按钮只作为体验层处理，不作为安全边界。

### D. 保留研究价值，替换产品语言和结果结构

可以保留：

- 行情、财务、公告、新闻、资金流和行业数据的来源展示；
- 非个性化的筛选条件和历史事实；
- 多空证据、假设、催化剂、失效条件和风险因素；
- 市场状态、波动、流动性和相对强弱等客观指标；
- 历史回测作为内部方法验证，或在严格披露限制下展示方法研究结果。

建议将“推荐、买入、建仓、加仓、减仓、卖出、订单计划、止损价、目标价”统一替换为“研究对象、证据摘要、待验证条件、风险观察、历史情景”。但仅替换词语不够，底层计算和返回结构也必须同步移除交易型字段。

### E. Agent 输出控制和测试要求

建议采用以下优先级：

1. 使用允许字段的结构化输出模型；不允许模型自行扩展为交易字段。
2. 服务端对动作枚举、价格/仓位字段和公开文案做最终校验，违规结果直接拒绝或转为研究摘要。
3. 对流式响应先在服务端缓冲并校验，再向浏览器推送，避免先泄露后撤回。
4. 为每次输出记录数据日期、来源、规则版本、模型/Skill 版本和合规模式，便于追溯。
5. 增加 `web/tests` 和 Agent Runtime 测试，至少覆盖：研究模式下交易动作被拒绝、执行计划字段不返回、交易 Skill 不可选、执行记录 API 被拒绝、定时任务不发送交易语义、违规 Agent 文本不会流出。

正则或关键词过滤只能作为最后一道补充防线，不能替代结构化契约和服务端权限控制。

### F. 个人信息、数据来源和公开运营

资产、现金、持仓和风险偏好应按高敏感度个人金融信息进行保护设计。上线前至少应明确：

- 收集目的、处理范围、保存期限和删除机制；
- 用户查询、更正、导出、删除及注销路径；
- 访问控制、加密、审计日志和异常告警；
- 第三方模型、数据供应商和日志系统是否接触这些信息；
- TuShare、新闻和其他数据的授权范围、展示限制、来源及数据日期。

市场测试阶段建议保持非收费、非荐股广告、无收益保证、无券商开户导流和无交易闭环，并在网站显著位置提供用户协议、隐私政策、风险揭示、数据来源和联系方式页面。正式公开前，应把最终功能和运营文案提交专业律师或有证券监管经验的合规顾问复核。


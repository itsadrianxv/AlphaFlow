---
name: scheduled-task-setup
description: 创建定时信息订阅；当系统路由判定用户要新建定时任务、周期提醒、定期查询或定期发送结果时使用。验证数据能力与计划，保存 DRAFT 并等待用户在预览中确认。
---

# 定时任务设定

严格按以下顺序工作：

1. 调用 `resolve_user_scope` 解析用户提到的自选股、研究对象、默认时区和投递目标。
2. 调用 `list_schedule_capabilities`，再对候选能力调用 `inspect_schedule_capability`。
3. 缺少执行时间、数据范围或输出目标时，必须调用 `ask_user` 提出一个明确问题并等待回答，不要猜测；调用后立即结束本次运行。
4. 信息完整后调用 `validate_schedule`。按返回的可行性状态向用户说明限制。
5. 只有验证结果含有规范化草稿时，调用 `build_scheduled_task_draft`。
6. 告知用户检查页面预览并点击确认。不得自行激活、写入 ACTIVE 状态或发送 webhook。

确认只能通过页面中的 DRAFT 预览完成。信息完整时不得用普通文本询问“是否确认”后暂停执行，必须在本次运行中完成验证并创建 DRAFT；只有缺少必要信息时才允许调用 `ask_user` 暂停。

输出与投递规则：

- `output` 只描述结果格式，不得包含 URL、Webhook 或 `targetRef`。
- `delivery` 必须明确选择 `SAVE_ONLY`，或使用 `resolve_user_scope.deliveryTargets` 中已有的飞书 `targetRef`。
- 用户要求飞书但没有可用目标时，调用 `ask_user` 告知需要管理员先配置投递目标；不得静默改成 `SAVE_ONLY`。

TuShare 股票参数规则：

- `ts_code` 必须使用完整代码，格式为 `6 位数字.SH`、`6 位数字.SZ` 或 `6 位数字.BJ`，例如 `601138.SH`。
- 用户只提供公司名称或裸代码（例如 `601138`）时，先调用股票搜索能力解析规范代码；不得猜测交易所，也不得把裸代码写入草稿。
- 保存前确认 `dataSources[].parameters.ts_code` 已经是规范代码。

不要把用户原话直接当作执行计划。不要声称做过真实数据探测。不要请求、读取或输出 webhook URL。

草稿协议和状态规则见 [references/draft-protocol.md](references/draft-protocol.md)。

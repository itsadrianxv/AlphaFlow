## 背景
某些定时任务是确定性很高的评估/评分任务，最适合的做法是通过 TuShare 获得数据之后，通过一套确定性的、程序化的方式进行评分，然后把评分结果投递给用户，而不是像一般的评分任务一样需要经由一个非确定性的 agent 来进行报告。

## 确定性的评分任务示例
获取某几支（可能很大量）股票的K线数据（月线/周线/日线），并且在K线数据的基础上计算kdj和macd指标。月线、周线、日线分别是阴线还是阳线、走势是否一致、kdj 和 macd 是否达到阈值，所有这些项都在最终评分当中占有一定的比值，从而筛选出值得投资的股票。这样的流程每天都要用最新的数据进行一次。

## 执行确定性定时任务的流程

1. 用户通过 Agent、可视化编辑器或手写生成 JSON。
2. 校验 JSON 的格式与规则语义。
3. 解析器将 JSON 转为数据需求和执行计划。
4. TuShare 适配器映射为 TuShare 数据集、字段及参数。
5. Provider 调用 TuShare 并返回标准化数据。
6. 规则执行引擎计算指标、比较条件、评分和筛选。
7. 结果交给前端、Agent 总结或投递器发送。

## 执行确定性定时任务的数据流

规则 JSON
→ parser.py
→ 标准数据需求
→ tushare.py 适配器
→ TuShare 查询参数
→ tushare_provider.py
→ 统一 K 线数据
→ indicators.py
→ 指标结果
→ engine.py
→ 评分结果

## 代码组织

python_services/app/
├── definitive_scheduled_tasks/
│   ├── schemas.py       # JSON Schema/Pydantic 校验
│   ├── json_parser.py      # 解析为数据需求和执行计划
│   ├── engine.py        # 规则计算、比较、评分
│   ├── indicators.py    # MACD、KDJ 等指标
├── data_adapters/
│   └── tushare.py       # 标准需求映射到 TuShare 参数
└── data_providers/
    └── tushare_provider.py

cpp/workers/definitive_task/
├── src/                    # Redis、lease、线程池、Python client、结果事务
└── tests/                  # 队列、重试及响应契约测试

## 执行计划顶层契约

`ScheduledTaskVersion.executionPlan` 使用以下显式分区，不包含调度时间和投递凭证：

```json
{
  "schemaVersion": 1,
  "type": "deterministic_scoring",
  "universe": { "type": "stocks", "stockCodes": ["600519"] },
  "data": { "adjustment": "qfq" },
  "indicators": [
    {
      "id": "macd_default",
      "type": "macd",
      "timeframes": ["daily", "weekly", "monthly"],
      "params": { "fast": 12, "slow": 26, "signal": 9 }
    }
  ],
  "rules": [],
  "selection": { "minScore": 60, "limit": 100 }
}
```

- `universe` 仅支持 `stocks` 与 `all_a_shares`。
- `adjustment` 支持 `qfq`、`hfq`、`none`，默认 `qfq`。
- 指标 MVP 包含 OHLCV、`candle.direction`、MACD 与 KDJ。
- MACD 默认 12/26/9，柱值为 `2 * (DIF - DEA)`；KDJ 默认 9/3/3，初始 K/D 为 50。
- 历史长度由解析器推导，每个使用周期至少预热 120 bars；交叉操作额外读取前一 bar。
- 原子操作符为 `gt/gte/lt/lte/eq/ne/between/cross_above/cross_below`，右侧仅接受常量。
- 条件树最多 8 层、200 个节点；规则最多 50 条，指标声明最多 20 个。

## 多周期与缺失语义

- 日线、周线和月线历史来自 TuShare 原生 OHLCV。
- 当前未收盘周线/月线由截止 `scheduledAt` 的日线本地聚合，替换同周期原生 bar。
- 条件结果为 `MATCHED`、`NOT_MATCHED`、`NOT_EVALUATED`。
- `all` 遇到明确不满足即不满足；`any` 遇到明确满足即满足；其他缺失状态向上传播；`not` 不反转未评估。
- 未评估规则得 0 分并记录原因。没有行情的股票仍保留审计行，但不能入选。
- 排名固定使用总分降序、股票代码升序；先应用 `minScore`，再取 `limit`。

## 队列和执行一致性

- Redis Stream `definitive-task:runs` 的消息只包含 schemaVersion、executionId、enqueuedAt。
- PostgreSQL 是执行计划唯一事实来源。worker 抢占时联表读取不可变版本，并构造 Python 请求。
- 执行状态为 `PENDING -> SUBMITTED -> RUNNING -> SUCCEEDED/RETRYING/FAILED`。
- `fencingToken`、lease 和 heartbeat 防止失效 worker 覆盖新结果；终态和结果必须在同一事务提交。
- 成功、永久失败或可靠写入重试状态后才 ACK。内存计时器按 10/30/90 秒重试，scheduler 对超期 30 秒的重试进行兜底发布。

## 结果和投递

- `ScheduledTaskExecution.result` 只保存汇总、规则元数据、警告和诊断。
- `ScheduledTaskScoreResult` 每只股票一行，保存排名、入选状态、分数和全部规则结果。
- Excel 下载时按需生成“评分总览”“规则说明”“执行信息”三张工作表。
- 飞书 Webhook 仅发送 Top N 摘要和站内 Excel 下载链接，不上传附件。

## json 描述规则

可以这样描述：

> 每条评分规则由条件和分值组成。条件既可以是针对某个周期、指标和目标值的单项比较，也可以通过“全部满足”“任一满足”和“取反”组合成复合条件。条件成立时获得该规则指定的分数，否则不得分。

对应关系是：

- 单项比较：`timeframe + metric + operator + value`
- 全部满足：`all`
- 任一满足：`any`
- 条件取反：`not`
- 得分：`points`

## json 规则示例

### 简单规则

{
  "id": "daily_macd_positive",
  "name": "日线 MACD 柱为正",
  "condition": {
    "timeframe": "daily",
    "metric": "macd.histogram",
    "operator": "gt",
    "value": 0
  },
  "points": 15
}

语义是 日线 MACD histogram > 0 时加 15 分，否则加 0 分。

### 复杂规则

{
  "id": "multi_timeframe_bullish",
  "name": "多周期趋势一致向上",
  "condition": {
    "all": [
      {
        "timeframe": "daily",
        "metric": "candle.direction",
        "operator": "eq",
        "value": "bullish"
      },
      {
        "timeframe": "weekly",
        "metric": "candle.direction",
        "operator": "eq",
        "value": "bullish"
      },
      {
        "any": [
          {
            "timeframe": "monthly",
            "metric": "macd.histogram",
            "operator": "gt",
            "value": 0
          },
          {
            "timeframe": "monthly",
            "metric": "kdj.j",
            "operator": "gt",
            "value": 50
          }
        ]
      }
    ]
  },
  "points": 25
}

语义是：日线阳线、周线阳线，并且月线 MACD 或 KDJ 至少一个满足条件时，加 25 分。

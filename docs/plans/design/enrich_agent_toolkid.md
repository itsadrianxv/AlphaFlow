# Pi Agent 数据工具集增强设计

## 背景

当前 Pi Agent 运行时只启用了 4 个内部工具：

- `internal_web_search`
- `internal_web_fetch`
- `internal_concept_match`
- `internal_screening_query`

其中只有 `internal_screening_query` 会通过 Python capability gateway 间接使用 TuShare provider。为了增强 AlphaFlow 在投研、筛选、择时和市场环境判断中的数据能力，需要为 Agent 增加一组面向业务任务的内部数据工具。


## 要加入的工具

本节用于把上面的工具清单落到可实现的 gateway/tool schema。字段命名采用 AlphaFlow 侧 camelCase；调用 TuShare 时再映射为 TuShare 原始 snake_case 参数。

### 通用约定

- 所有日期入参统一使用 `YYYYMMDD`，例如 `20250708`。
- Agent 工具入参使用 `stockCode`、`indexCode`、`fundCode`、`bondCode`；Python gateway 内部负责转换为 TuShare `ts_code` / `index_code`。
- 单股票接口默认优先按 `ts_code` 查询；若用户只给 6 位代码，先通过 `internal_stock_search` 或本地股票池补齐交易所后缀。
- 返回体必须包含：
  - `provider`: 固定为 `tushare`
  - `api`: 实际调用的 TuShare API 名称或数组
  - `request`: 标准化后的请求参数
  - `rows`: 数据行
  - `warnings`: 缺字段、权限、截断、空结果等提示
  - `diagnostics`: trace、耗时、行数、是否缓存命中、TuShare 限额相关信息
- Python capability route 建议统一放在 `/api/v1/capabilities/market/...` 下。
- `fields` 应在后端白名单内固定，不允许 Agent 任意传 TuShare `fields` 字符串。

### 1. `internal_stock_search`

建议 route：`POST /api/v1/capabilities/market/stock/search`

TuShare API：

- `stock_basic`

TuShare 官方要点：

- `stock_basic` 获取股票基础信息，包括代码、名称、上市日期、退市日期等。
- 单次最多返回 6000 行，官方建议基础信息拉取后保存到本地使用。
- 常用入参：`ts_code`、`name`、`market`、`list_status`、`exchange`、`is_hs`。
- 常用出参：`ts_code`、`symbol`、`name`、`area`、`industry`、`cnspell`、`market`、`exchange`、`list_status`、`list_date`、`delist_date`、`is_hs`、`act_name`、`act_ent_type`。

Agent 入参：

```json
{
  "keyword": "茅台",
  "limit": 10,
  "listStatus": "L",
  "exchange": null
}
```

实现建议：

- 优先查本地缓存股票池，缓存 miss 再调用 `stock_basic`。
- `keyword` 同时匹配 `symbol`、`name`、`cnspell`、`industry`。
- `listStatus` 默认 `L`，允许 `L`、`D`、`P`、`G`。

### 2. `internal_stock_profile`

建议 route：`POST /api/v1/capabilities/market/stock/profile`

TuShare API：

- `stock_basic`
- `stock_company`

TuShare 官方要点：

- `stock_company` 获取上市公司基础信息，单次可提取 4500 条，可按交易所分批提取。
- `stock_company` 常用出参包括公司全称、统一社会信用代码、交易所、法人代表、总经理、董秘、注册资本、注册日期、省市、公司主页、员工人数、主营业务、经营范围。

Agent 入参：

```json
{
  "stockCode": "600519",
  "includeCompany": true
}
```

实现建议：

- 基础证券信息来自 `stock_basic`。
- 公司经营画像来自 `stock_company`。
- 返回中区分 `security` 和 `company` 两个对象，避免字段含义混杂。

### 3. `internal_stock_bars`

建议 route：`POST /api/v1/capabilities/market/stock/bars`

TuShare API：

- `daily`
- `weekly`
- `monthly`
- `pro_bar`

TuShare 官方要点：

- `daily` 是 A 股未复权日线，停牌期间不提供数据。
- `daily` 入参包括 `ts_code`、`trade_date`、`start_date`、`end_date`。
- `daily` 出参包括 `open`、`high`、`low`、`close`、`pre_close`、`change`、`pct_chg`、`vol`、`amount`。
- 官方提示按交易日循环拉全市场数据，不建议按股票循环拉历史全量。

Agent 入参：

```json
{
  "stockCode": "600519",
  "startDate": "20250101",
  "endDate": "20250708",
  "freq": "daily",
  "adjust": "qfq"
}
```

实现建议：

- `freq=daily` 且 `adjust=none` 时可直接调用 `daily`。
- `adjust=qfq/hfq` 时使用 `pro_bar`。
- `freq=weekly/monthly` 对应 `weekly` / `monthly`，如需复权周月线再评估是否走 `pro_bar` 或专门复权接口。
- 返回字段统一为 `open`、`high`、`low`、`close`、`preClose`、`changeAmount`、`changePercent`、`volume`、`amount`。

### 4. `internal_stock_daily_basic`

建议 route：`POST /api/v1/capabilities/market/stock/daily-basic`

TuShare API：

- `daily_basic`

TuShare 官方要点：

- `daily_basic` 获取全部股票每日重要基本面指标，可用于选股分析和报表展示。
- 交易日每日 15 点至 17 点更新。
- 单次请求最大返回 6000 条。
- 入参包括 `ts_code`、`trade_date`、`start_date`、`end_date`。
- 出参包括 `turnover_rate`、`turnover_rate_f`、`volume_ratio`、`pe`、`pe_ttm`、`pb`、`ps`、`ps_ttm`、`dv_ratio`、`dv_ttm`、`total_share`、`float_share`、`free_share`、`total_mv`、`circ_mv`、`limit_status`。

Agent 入参：

```json
{
  "stockCode": "600519",
  "tradeDate": null,
  "startDate": "20250101",
  "endDate": "20250708"
}
```

实现建议：

- 支持两种模式：单股票区间、单交易日全市场截面。
- `tradeDate` 和 `startDate/endDate` 至少一组有效。
- `limit_status` 应映射为可读枚举，例如 `limitUp`、`limitDown`、`flat`、`normalUp`、`normalDown`。

### 5. `internal_index_market`

建议 route：`POST /api/v1/capabilities/market/index/market`

TuShare API：

- `index_basic`
- `index_daily`
- `index_dailybasic`

TuShare 官方要点：

- `index_daily` 获取指数每日行情，单次最多取 8000 行，可设置起止日期补全。
- `index_daily` 不包含申万行业指数行情；申万行业行情需要使用对应行业指数接口。
- `index_dailybasic` 提供大盘指数每日指标，目前覆盖重点大盘指数。

Agent 入参：

```json
{
  "indexCode": "000300.SH",
  "startDate": "20250101",
  "endDate": "20250708",
  "includeBasic": true,
  "includeValuation": true
}
```

实现建议：

- `index_basic` 返回指数名称、市场、发布方、类别等基础信息。
- `index_daily` 返回 OHLCV。
- `index_dailybasic` 返回指数估值、换手、成交等每日指标；若目标指数不支持，应在 `warnings` 中说明。

### 6. `internal_index_constituents`

建议 route：`POST /api/v1/capabilities/market/index/constituents`

TuShare API：

- `index_weight`
- `index_classify`
- `index_member_all`

TuShare 官方要点：

- `index_weight` 获取各类指数成分和权重，是月度数据。
- 官方建议开始日期和结束日期分别传当月第一天和最后一天。
- `index_weight` 入参包括 `index_code`、`trade_date`、`start_date`、`end_date`。
- `index_weight` 出参包括 `index_code`、`con_code`、`trade_date`、`weight`。

Agent 入参：

```json
{
  "indexCode": "000300.SH",
  "tradeDate": "20250708",
  "startDate": null,
  "endDate": null,
  "includeNames": true
}
```

实现建议：

- 对宽基指数优先使用 `index_weight`。
- 对申万行业分类和行业成分使用 `index_classify` / `index_member_all`。
- 若 `includeNames=true`，用本地股票池补充 `stockName`、`industry`。

### 7. `internal_moneyflow`

建议 route：`POST /api/v1/capabilities/market/stock/moneyflow`

TuShare API：

- `moneyflow`
- `margin`
- `margin_detail`
- `hk_hold`

TuShare 官方要点：

- `moneyflow` 获取沪深 A 股票资金流向数据，用于分析大单小单成交和资金动向。
- `moneyflow` 数据开始于 2010 年，单次最大提取 6000 行。
- `moneyflow` 入参包括 `ts_code`、`trade_date`、`start_date`、`end_date`。
- `moneyflow` 出参包括小单、中单、大单、特大单买卖量和买卖金额，以及 `net_mf_vol`、`net_mf_amount`。
- 官方说明净流入基于 L2 主动买卖单统计，不能简单用大小单总和相减。

Agent 入参：

```json
{
  "stockCode": "600519",
  "tradeDate": null,
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["moneyflow", "margin", "hkHold"]
}
```

实现建议：

- `moneyflow` 返回细分单量和净流入。
- `margin` / `margin_detail` 返回两融市场或个股明细。
- `hk_hold` 返回沪深股通持股。
- 不要在后端自行重算 `net_mf_amount` 作为权威值；以 TuShare 字段为准。

### 8. `internal_market_events`

建议 route：`POST /api/v1/capabilities/market/events`

TuShare API：

- `top_list`
- `top_inst`
- `block_trade`
- `stk_limit`

TuShare 官方要点：

- 官方权限页列出：`top_list` 为龙虎榜每日明细，数据开始于 2005 年，每日晚 8 点更新。
- `top_inst` 为龙虎榜机构交易明细，数据开始于 2005 年，每日晚 8 点更新。
- `stk_limit` 是每日涨跌停价格，通常用于获取涨停价、跌停价等。

Agent 入参：

```json
{
  "tradeDate": "20250708",
  "stockCode": "600519",
  "include": ["topList", "topInst", "blockTrade", "limit"]
}
```

实现建议：

- `stockCode` 可选；不传时返回指定交易日市场事件截面。
- `topList` 和 `topInst` 应按 `tradeDate` 查询。
- `stkLimit` 可作为涨跌停状态判断的基础数据，与 `daily_basic.limit_status` 互补。

### 9. `internal_shareholder_events`

建议 route：`POST /api/v1/capabilities/market/stock/shareholder-events`

TuShare API：

- `stk_holdernumber`
- `stk_holdertrade`
- `pledge_detail`
- `pledge_stat`
- `share_float`
- `repurchase`

TuShare 官方要点：

- `stk_holdernumber` 获取上市公司股东户数数据，数据不定期公布。
- `stk_holdernumber` 单次最大 3000 行，基础积分每分钟 100 次。
- `stk_holdernumber` 入参包括 `ts_code`、`ann_date`、`enddate`、`start_date`、`end_date`。
- `stk_holdernumber` 出参包括 `ts_code`、`ann_date`、`end_date`、`holder_num`。
- 官方权限页列出 `pledge_detail` 股权质押明细和 `pledge_stat` 股权质押统计。

Agent 入参：

```json
{
  "stockCode": "600519",
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["holderNumber", "holderTrade", "pledge", "shareFloat", "repurchase"]
}
```

实现建议：

- 股东户数按公告日过滤；返回时同时保留公告日和截止日。
- 质押数据拆分为 `pledgeDetails` 和 `pledgeStats`。
- 解禁、增减持、回购属于事件流，返回应按日期倒序。

### 10. `internal_financial_statements`

建议 route：`POST /api/v1/capabilities/market/stock/financial-statements`

TuShare API：

- `income`
- `balancesheet`
- `cashflow`

TuShare 官方要点：

- `income` 获取上市公司利润表数据。
- `income` 当前接口只能按单只股票获取历史数据；如需某一季度全部上市公司数据，应使用 VIP 接口。
- `income` 入参包括 `ts_code`、`ann_date`、`f_ann_date`、`start_date`、`end_date`、`period`、`report_type`、`comp_type`。
- `income` 出参包含 `basic_eps`、`total_revenue`、`revenue`、`operate_profit`、`total_profit`、`n_income`、`n_income_attr_p`、`ebit`、`ebitda`、`rd_exp` 等。

Agent 入参：

```json
{
  "stockCode": "600519",
  "startDate": "20230101",
  "endDate": "20250630",
  "period": null,
  "statement": "all",
  "reportType": "1"
}
```

实现建议：

- `statement=all` 时并行或顺序调用三大报表，返回 `income`、`balanceSheet`、`cashFlow` 三个数组。
- 默认 `reportType=1`，表示合并报表；如返回多种报表类型，应在结果中保留 `reportType`。
- 对 Agent 默认只返回精选核心字段，避免一次响应过大；完整字段可由后端配置白名单。

### 11. `internal_financial_indicators`

建议 route：`POST /api/v1/capabilities/market/stock/financial-indicators`

TuShare API：

- `fina_indicator`
- `fina_mainbz`
- `fina_audit`

TuShare 官方要点：

- `fina_indicator` 获取上市公司财务指标数据。
- 当前普通接口每次请求最多返回 100 条记录；全市场季度数据需使用 VIP 接口。
- 入参包括 `ts_code`、`ann_date`、`start_date`、`end_date`、`period`。
- 常用出参包括 `eps`、`dt_eps`、`gross_margin`、`current_ratio`、`quick_ratio`、`roe`、`roe_waa`、`roa`、`roic`、`netprofit_margin`、`grossprofit_margin`、`debt_to_assets`、`ocf_to_or`、`tr_yoy`、`or_yoy`、`netprofit_yoy`、`rd_exp`。

Agent 入参：

```json
{
  "stockCode": "600519",
  "startDate": "20230101",
  "endDate": "20250630",
  "period": null,
  "include": ["indicator", "mainBusiness", "audit"]
}
```

实现建议：

- 指标按质量、盈利、成长、偿债、现金流、研发分组返回，方便 Agent 解释。
- `fina_mainbz` 返回主营构成；`fina_audit` 返回审计意见。
- 对 `fina_indicator` 做最多 100 条的结果保护和日期分页。

### 12. `internal_earnings_events`

建议 route：`POST /api/v1/capabilities/market/stock/earnings-events`

TuShare API：

- `forecast`
- `express`
- `disclosure_date`
- `dividend`

Agent 入参：

```json
{
  "stockCode": "600519",
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["forecast", "express", "disclosureDate", "dividend"]
}
```

实现建议：

- `forecast` 用于业绩预告事件和变动区间。
- `express` 用于业绩快报。
- `disclosure_date` 用于财报预约披露日。
- `dividend` 用于分红送转。
- 返回统一事件结构：`eventType`、`annDate`、`period`、`summary`、`raw`。

### 13. `internal_fund_market`

建议 route：`POST /api/v1/capabilities/market/fund/market`

TuShare API：

- `fund_basic`
- `fund_nav`
- `fund_daily`
- `fund_portfolio`

TuShare 官方要点：

- 官方接口索引列出基金列表、基金净值、基金日线行情和基金持仓等公募基金接口。

Agent 入参：

```json
{
  "fundCode": "510300.SH",
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["basic", "nav", "daily", "portfolio"]
}
```

实现建议：

- ETF/场内基金行情走 `fund_daily`。
- 净值走 `fund_nav`。
- 持仓走 `fund_portfolio`，注意其通常为季度频率。

### 14. `internal_convertible_bond_market`

建议 route：`POST /api/v1/capabilities/market/convertible-bond/market`

TuShare API：

- `cb_basic`
- `cb_issue`
- `cb_daily`

TuShare 官方要点：

- 官方接口索引列出可转债基础信息、可转债发行和可转债行情接口。

Agent 入参：

```json
{
  "bondCode": "113000.SH",
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["basic", "issue", "daily"]
}
```

实现建议：

- 基础条款走 `cb_basic`。
- 发行信息走 `cb_issue`。
- 行情走 `cb_daily`。
- 后续可扩展转股价变动、赎回、回售等事件接口。

### 15. `internal_macro_rates`

建议 route：`POST /api/v1/capabilities/market/macro/rates`

TuShare API：

- `shibor`
- `shibor_lpr`
- `libor`
- `hibor`

TuShare 官方要点：

- 官方接口索引列出 SHIBOR、LPR、LIBOR、HIBOR 等利率数据接口。

Agent 入参：

```json
{
  "startDate": "20250101",
  "endDate": "20250708",
  "include": ["shibor", "lpr", "libor", "hibor"]
}
```

实现建议：

- 返回统一利率序列结构：`rateType`、`date`、`tenor`、`rate`。
- 用于市场状态、流动性、估值压力分析，不直接给出买卖建议。

## 官方文档参考

- TuShare HTTP 调用方式：https://tushare.pro/document/1?doc_id=130
- TuShare 权限与接口索引：https://tushare.pro/document/1?doc_id=108
- 股票基础信息 `stock_basic`：https://tushare.pro/wctapi/documents/25.md
- 上市公司基本信息 `stock_company`：https://tushare.pro/wctapi/documents/112.md
- A 股日线行情 `daily`：https://tushare.pro/wctapi/documents/27.md
- 每日指标 `daily_basic`：https://tushare.pro/wctapi/documents/32.md
- 指数日线行情 `index_daily`：https://tushare.pro/wctapi/documents/95.md
- 指数成分和权重 `index_weight`：https://tushare.pro/wctapi/documents/96.md
- 个股资金流向 `moneyflow`：https://tushare.pro/wctapi/documents/170.md
- 股东人数 `stk_holdernumber`：https://tushare.pro/wctapi/documents/166.md
- 利润表 `income`：https://tushare.pro/wctapi/documents/33.md
- 财务指标 `fina_indicator`：https://tushare.pro/wctapi/documents/79.md


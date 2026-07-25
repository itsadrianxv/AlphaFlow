择时组合页面上：
  1. 执行风控：不是完全占位，但触发/失效条件还偏“说明文本” 

  组合执行风控已经有真实逻辑，主要在 WatchlistRiskManagerService 和
  WatchlistPortfolioManagerService：

  - 用现金比例、单票上限、主题/行业集中度、市场状态计算
    portfolioRiskBudgetPct、maxSingleNamePct、defaultProbePct。

  - RISK_OFF 会限制 ADD，必要时连 PROBE 也禁用。
  - 持仓接近失效位时，会把 ADD/PROBE 降级为 TRIM/HOLD/EXIT。
  - 成熟盈利 + 市场恶化时会倾向 TRIM。
  - 复盘反馈样本会影响后续排序和参数建议。

  但“触发条件 / 失效条件”本身现在确实更像占位式文本：triggerNotes 是
  正向技术因子说明，invalidationNotes 是负向因子说明；如果没有负向因
  子，就用默认句子“若多周期结构破坏且相对强弱继续下滑...”。它还不是结
  构化规则，例如“收盘跌破 EMA20 两天”“放量跌破某价位”“相对强弱低于阈
  值”这种可执行条件。

  建议优化方向：

  - 把 triggerNotes/invalidationNotes 升级为结构化字段，例如 {type,
    metric, operator, threshold, lookback, severity, explanation}。

  - 失效条件优先从价格结构生成：EMA20/EMA60、近期低点、ATR 止损、用户
    输入的 invalidationPrice。

  - 触发条件分层：趋势触发、突破触发、相对强弱触发、量能确认、Kronos
    辅助确认。

  - 执行风控应消费这些结构化条件，而不是只展示文本。
  - 页面仍可展示中文说明，但底层要能判断“已触发 / 接近 / 未触发”。

  2. 市场环境：当前通用接口不适合，择时应换成 TuShare 行情型接口

  现状有两套市场环境：

  - 通用 market-context：依赖宏观、北向、热点主题、新闻、候选股，接口
    链路长，任何一环不稳定就容易 partial/unavailable。

  - 择时工作流里的 timing_market_context：已经更贴近择时，用全市场快
    照、指数代理、广度、波动、领涨代理算 RISK_ON/NEUTRAL/RISK_OFF。

  问题在于择时的 timing_market_context 现在仍依赖
  get_market_snapshot() 拉全市场 daily + daily_basic，并且指数代理用
  ETF 代码去拉日线。这个方向对，但数据结构还可以更明确地改成 TuShare
  的行情/市场统计接口。

  适合优先用的 TuShare 2000 积分级接口：

  - daily：全市场日行情，拿涨跌幅、成交额、涨跌家数基础。
  - daily_basic：全市场每日指标，拿换手率、量比、市值、limit_status，
    很适合算市场广度、活跃度、涨跌停状态。

  - stk_limit：每日涨跌停价格，用于识别封板/接近跌停/涨跌停风险，配合
    daily.close 可算真实涨跌停分布。

  - index_daily：沪深300、中证500、创业板、科创50等指数行情，替代 ETF
    代理更直接。

  - index_dailybasic：指数估值、市值、换手率，适合判断大盘成交/估值环
    境。

  - moneyflow_hsgt：北向/南向资金流，作为辅助项，不作为市场环境能否显
    示的硬依赖。

  建议择时市场环境重构成“行情优先、资金辅助、宏观不参与阻塞”：

  - 核心可用性只依赖 daily + daily_basic + index_daily。
  - stk_limit/index_dailybasic/moneyflow_hsgt 缺失时降级，但仍显示市
    场环境。

  - 状态评分用：
      - 上涨家数占比、涨超 3% / 跌超 3% 占比；
      - 跌停/接近跌停数量；
      - 高波动股票占比；
      - 全市场平均换手、量比；
      - 主指数是否站上 EMA20/EMA60；
      - 5日/10日领涨指数或风格切换；
      - 北向资金只做加减分。

  - 不再让热点主题、新闻、宏观慢变量影响择时执行风控的市场环境展示。

  3. 复盘跟踪：不能直接说没用，不建议现在删

  复盘跟踪不是摆设。代码里有完整闭环：

  - 生成择时卡/组合建议后，会按 preset 的 reviewSchedule.horizons 创
    建 T5/T10/T20 复盘记录。

  - TimingReviewLoopLangGraph 会加载到期记录，拉行情，计算实际收益、
    最大有利波动、最大不利波动。

  - 完成后写入 TimingFeedbackObservation。
  - TimingFeedbackService 会基于复盘样本生成策略参数调整建议，比如信
    号权重、市场环境权重、进攻动作阈值。

  所以它的问题不是“没使用”，而是可能“没有触发起来 / 默认 schedule 为
  空 / 样本不够 / UI 长期空”。如果删掉，会把择时系统里最有价值的学习
  闭环也删掉。

  更合理的处理：

  - 保留复盘跟踪。
  - 检查默认 preset 是否开启 reviewSchedule.horizons，至少默认 T10/
    T20。

  - 页面空态改成解释“暂无到期复盘”，而不是像废弃模块。
  - 增加手动执行“处理到期复盘”的入口。
  - 复盘记录数量不足时，不展示复杂反馈建议，只展示样本积累进度。

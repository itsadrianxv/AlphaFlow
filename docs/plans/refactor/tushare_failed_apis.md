I only have 2000 credits on TuShare. With 2000 TuShare credits, the APIs that will fail in the current project are:

   API                       Required permission    Current project
                                                    impact
  ━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━
   ths_index                        6000 credits    Breaks 行业研究
                                                    concept catalog/
                                                    matching. This
                                                    is your error.
  ────────────────  ─────────────────────────────  ──────────────────
   ths_member                       6000 credits    Will fail next
                                                    when loading THS
                                                    concept
                                                    constituents/
                                                    candidates.
  ────────────────  ─────────────────────────────  ──────────────────
   ths_daily                        6000 credits    Added as
                                                    supported raw
                                                    dataset, not
                                                    core path right
                                                    now.
  ────────────────  ─────────────────────────────  ──────────────────
   ths_hot                          6000 credits    Added as
                                                    supported raw
                                                    dataset, not
                                                    core path right
                                                    now.
  ────────────────  ─────────────────────────────  ──────────────────
   fund_daily                       5000 credits    Breaks ETF/fund
                                                    daily market
                                                    data in
                                                    fund_market /
                                                    ETF snapshot
                                                    enrichment.
  ────────────────  ─────────────────────────────  ──────────────────
   fund_portfolio                   5000 credits    Breaks fund
                                                    holding/
                                                    portfolio data
                                                    in fund_market.
  ────────────────  ─────────────────────────────  ──────────────────
   news                 separate permission, not    Not available by
                                          points    2000 credits.
                                                    Currently
                                                    disabled by
                                                    default, so it
                                                    should not be
                                                    causing this
                                                    error.

  Everything else we mainly rely on should be OK at 2000 credits:
  stock_basic, daily, daily_basic, stock_company, income,
  balancesheet, cashflow, fina_indicator, index_daily, index_weight,
  index_classify, index_member_all, fund_basic, fund_nav, cb_basic,
  cb_issue, cb_daily, moneyflow, etc.
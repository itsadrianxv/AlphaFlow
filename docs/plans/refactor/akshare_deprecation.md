we are planning to move all AkShare APIs to TuShare. That is, deprecating the entirety of python_services\app\providers\akshare


能完全换到 TuShare 的部分:
  - 股票列表 / 代码名称 / 行业：stock_basic
  - 公司基础资料：stock_company
  - 日线行情：daily / pro_bar
  - 每日估值、PE/PB、市值、换手：daily_basic
  - 财务指标：fina_indicator
  - 三大报表：income / balancesheet / cashflow
  - 基金/ETF：fund_basic / fund_nav / fund_daily / fund_portfolio
  - 可转债：cb_basic / cb_issue / cb_daily
  - 指数/行业分类：index_basic / index_daily / index_weight /
    index_classify / index_member_all

  TuShare 官方权限表明确列了这些接口和更新频率，股票、财务、基金、指数、债
  券、宏观都有覆盖。尤其 stock_basic、daily、daily_basic、财报和基金接口都
  能替换当前 AkShare market gateway 的主体数据。来源：TuShare 权限/API 索
  引、stock_basic、daily、income 文档。
  Sources: https://tushare.pro/document/1?doc_id=108,
  https://tushare.pro/wctapi/documents/25.md,
  https://tushare.pro/wctapi/documents/27.md,
  https://tushare.pro/wctapi/documents/33.md

能换，但要改产品逻辑的部分:
 - 主题候选股 / 概念匹配：
      - AkShare 当前靠同花顺概念板块抓取。
      - TuShare 有 ths_hot，覆盖热股、概念板块、ETF、可转债等，但这是“热
        榜/标签/热度”数据，不是完全等价的概念成分股接口。

      - 也可用 index_classify / index_member_all 做申万行业成分，但它更偏
        行业分类，不等价于同花顺概念板块。

      - 所以 theme candidates 可以迁到 TuShare，但 ranking/reason 逻辑要重
        写。

- 直接删掉 AkShare 对应接口，不做 TuShare 替换的部分：
项目中的 news 接口
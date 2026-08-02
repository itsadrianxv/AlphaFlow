# TuShare 与 Minishare 数据能力、时效与使用边界核定

> 对应 GitHub Issue：[#7 核定 TuShare 与 Minishare 的数据能力、时效与使用边界](https://github.com/itsadrianxv/AlphaFlow/issues/7)  
> 研究日期：2026-08-01  
> 研究范围：TuShare 15000 积分、Minishare 当前官方目录、AlphaFlow 现有适配器；只核定数据源，不设计具体页面或实现产品功能。

## 结论摘要

1. **TuShare 15000 积分适合做盘后结构化数据主干，但不等于全权限。** 官方权限表将 15000+ 定义为 500 次/分钟、特色数据无每天总量限制；日线、每日指标、财务、资金流、龙虎榜、卖方盈利预测等相关积分接口均可覆盖。但实时日线/分钟、新闻、公告、政策法规和券商研报属于独立权限，与积分无关。[TuShare 积分与频次权限表](https://tushare.pro/document/1?doc_id=290)
2. **当前个人 15000 积分不能直接用于 AlphaFlow 的商业服务。** TuShare 数据服务协议授予的是个人、不可转让、非商业、可撤销、有期限的许可，并限定为个人查看；面向用户展示、加工和推送之前，必须取得 TuShare 及相关第三方数据权利人的机构/商业书面授权。[TuShare 数据服务协议](https://tushare.pro/document/1?doc_id=405)
3. **Minishare 技术目录比仓库当前接入范围更广，但商业边界更不确定。** 官方目录除三类新闻外，还提供上市公司公告、政策法规、货币政策报告、券商研报、沪深交易所董秘问答，以及实时/分钟行情。官方公开页面没有给出服务级限流、SLA 或数据再分发条款；SDK 的 MIT 元数据只许可软件，不等于许可其返回的数据。商业上线前必须向 Minishare 取得书面授权。[Minishare 官方文档](https://minidoc.pages.dev/)；[官方 SDK 0.1009.0](https://minidoc.pages.dev/packages/minishare/minishare-0.1009.0-py3-none-any.whl)
4. **六类信息域能够形成完整的盘前/盘后基线，盘中能力需单独采购和校准。** 仅凭 TuShare 15000 积分，核心结构化数据大多在收盘后至晚间更新；无法承诺盘中两分钟级市场结构。可选方案是另开 TuShare 实时权限，或在完成权限、质量与商业授权核验后引入 Minishare 实时行情。[TuShare 权限表](https://tushare.pro/document/1?doc_id=290)；[Minishare 实时日线](https://minidoc.pages.dev/#rt-k)
5. **接口标注的更新时间不是 SLA。** TuShare 明确不保证数据及时性、准确性、完备性及服务持续稳定；Minishare 未公开 SLA。规格应使用“上游公布更新窗口 + 实际观测延迟 + 数据截止点”，不要给所有数据观测、研究事件和推送设置统一硬时限。[TuShare 数据服务协议](https://tushare.pro/document/1?doc_id=405)
6. **数据源只能先生成规范化对象。** 结构化数值进入“数据观测”；新闻、公告、政策、董秘问答等先成为“研究事件候选”。异常数据只触发核查，不能自动成为研究事件。任何分发都必须在证据归一、去重、权利检查及 LLM 四项评分之后由代码决策。[项目上下文](../../CONTEXT.md)

## 判定口径

本报告把“可用”拆成三种状态，避免把技术可调用误写成产品可上线：

| 状态 | 含义 | 产品处理 |
| --- | --- | --- |
| 积分可用 | 15000 积分已高于该接口门槛 | 仍需商业授权；按接口行数、频次和更新时间编排 |
| 独立权限 | 与积分无关，需要单独购买/开通 | 未验证账户 entitlement 时视为不可用 |
| 待授权/待校准 | 官方有接口，但未公开商业再分发权、SLA、限流或完整历史范围 | 只可做技术候选，不能进入生产数据源清单 |

接口页中的更新时间是供应方的**预期入库窗口**，不是端到端承诺。产品应至少记录 `source_published_at`、`upstream_as_of`、`ingested_at`、`normalized_at`、`freshness_status` 和 `entitlement_id`，并按数据源保存实际延迟分布。

## TuShare 15000 积分与独立权限

### 账户级边界

| 项目 | 官方规则 | 对 AlphaFlow 的约束 |
| --- | --- | --- |
| 15000+ 积分档 | 500 次/分钟；特色数据无每天总量限制；积分和独立权限通常一年有效、不扣减 | 可支撑并发拉取，但每个接口仍有单次行数、日限量和自身门槛，不能只做全局限流器 |
| 独立权限 | 历史/实时分钟、实时日线、新闻、公告、政策、研报等与积分无关 | entitlement 必须逐接口配置并在启动时验证，不能由 `TUSHARE_CREDITS=15000` 推断 |
| 许可范围 | 普通协议为个人、非商业、仅个人查看 | 商业上线前必须另签机构/商业许可，明确缓存、加工、展示、推送、引用、删除和合同终止后的数据处理 |
| 质量保证 | 不保证准确、完整、及时或持续可用 | 所有结果显示来源时间、完整性和修订；上游失败时降级，不静默复用旧数据 |

来源：[积分与频次权限表](https://tushare.pro/document/1?doc_id=290)、[积分规则](https://tushare.pro/document/1?doc_id=13)、[数据服务协议](https://tushare.pro/document/1?doc_id=405)。TuShare 提供机构 API 咨询入口，但该页面本身不授予再分发权：[API 服务](https://tushare.pro/document/1?doc_id=11)、[定制服务](https://tushare.pro/document/1?doc_id=12)。

### 六类信息域覆盖

#### 1. 市场结构

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| `daily` A 股日线 | 积分可用；单次 6000；基础积分页称可达 500 次/分钟 | 交易日约 15:00-16:00 入库；单股一次可覆盖约 23 年 | 生成价格、成交、涨跌分布等数据观测；不能代表盘中实时状态。[官方文档](https://tushare.pro/document/2?doc_id=27) |
| `daily_basic` 每日指标 | 2000 积分；单次 6000；5000+ 无总量限制 | 交易日 15:00-17:00；可按日循环历史 | 生成换手率、量比、估值、市值、涨跌停状态观测。[官方文档](https://tushare.pro/document/2?doc_id=32) |
| `index_daily`、`index_dailybasic` | 均为 2000 积分；后者文档称历史自 2004-01 | 盘后日频；具体接口页未统一给出更新窗口 | 覆盖核心指数价格、成交、估值和市场规模。注意深证成指等指数成交口径与行情软件的全市场口径不同。[指数日线](https://tushare.pro/document/2?doc_id=95)、[指数每日指标](https://tushare.pro/document/2?doc_id=128) |
| `index_classify`、`index_member_all`、`sw_daily` | 2000/5000 积分级；`sw_daily` 单次 4000 | 申万 2014/2021 分类；行业行情日频 | 用申万分类形成行业层级和行业强弱观测。[行业分类](https://tushare.pro/document/2?doc_id=181)、[行业成分](https://tushare.pro/document/2?doc_id=335)、[申万日线](https://tushare.pro/document/2?doc_id=327) |
| `ths_index`、`ths_member`、`ths_daily` | `ths_daily` 6000 积分、单次 3000 | 概念/行业板块日频；历史起点和固定更新时间未公开 | 可补充概念板块，但必须保留 `THS` 来源和商业授权状态。[板块行情](https://tushare.pro/document/2?doc_id=260) |
| `rt_k`、`rt_min`、`rt_sw_k` | **独立权限**；积分不生效 | 盘中实时；频次以独立权限表为准 | 只有开通并实测后才能支撑盘中市场结构。[实时日线](https://tushare.pro/document/2?doc_id=372)、[实时分钟](https://tushare.pro/document/2?doc_id=374)、[申万实时](https://tushare.pro/document/2?doc_id=417) |

**核定：** 15000 积分可完整支持专业盘后市场结构和盘前引用上一交易日快照；不能单独支持可靠的盘中基线。

#### 2. 资金与交易行为

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| `moneyflow` | 2000 积分；单次 6000，总量不限 | 2010 年起；官方更新说明约 19:00 | 生成个股大小单资金流数据观测，不把资金异常直接当事件。[官方文档](https://tushare.pro/document/2?doc_id=170) |
| `moneyflow_mkt_dc`、`moneyflow_ths`、`moneyflow_ind_ths`、`moneyflow_cnt_ths` | 6000 积分级；单次 3000/6000/5000/5000 | 均为每日盘后或日频 | 覆盖大盘、个股、行业、概念资金结构；保留 DC/THS 的第三方口径标签。[大盘](https://tushare.pro/document/2?doc_id=345)、[个股](https://tushare.pro/document/2?doc_id=348)、[行业](https://tushare.pro/document/2?doc_id=343)、[概念](https://tushare.pro/document/2?doc_id=371) |
| `margin`、`margin_detail` | 2000 积分；单次 4000/6000 | 交易所约次日 8:30 更新上一日 | 形成两融余额与交易变化观测，不属于当日盘中实时资金。[汇总](https://tushare.pro/document/2?doc_id=58)、[明细](https://tushare.pro/document/2?doc_id=59) |
| `top_list`、`top_inst` | 2000/5000 积分；单次均 10000 | `top_list` 自 2005 年；盘后 | 龙虎榜入榜及机构交易可以成为事件候选，但“为什么值得研究”仍需增量、实体和证据判断。[龙虎榜](https://tushare.pro/document/2?doc_id=106)、[机构明细](https://tushare.pro/document/2?doc_id=107) |
| `limit_list_ths` | 8000+ 可 500 次/分钟且无日总量；单次 4000 | 2023-11-01 起；约 16:00 更新 | 盘后涨跌停结构观测。官方明确仅限个人学习研究，商业用途需联系同花顺，故商业授权前禁止进入用户分发。[官方文档](https://tushare.pro/document/2?doc_id=355) |
| `ths_hot`、`dc_hot` | 6000/8000 积分；单次 2000 | 每日盘中 4 次、盘后 4 次，最晚约 22:00-22:30 | 只作为供应商热度观测，不能当作现实事件或重要性证据。[THS 热榜](https://tushare.pro/document/2?doc_id=320)、[DC 热榜](https://tushare.pro/document/2?doc_id=321) |

**核定：** 足以形成专业盘后资金、两融、龙虎榜、热度和涨跌停基线；第三方加工数据的商业权利是上线门槛。

#### 3. 公司信息

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| `stock_basic`、`stock_company` | 2000/120 积分；单次约 6000/4500 | 基础列表低频更新 | 形成公司实体主数据，必须本地保存并处理名称、上市状态和行业版本变化。[股票基础](https://tushare.pro/document/2?doc_id=25)、[公司基础](https://tushare.pro/document/2?doc_id=112) |
| `income`、`balancesheet`、`cashflow`、`fina_indicator` | 普通版 2000；全市场报告期 `_vip` 版 5000 | 随披露更新；普通版按单股历史；财务指标单次 100 | 规范化为财务数据观测；通过 `ann_date`/`f_ann_date` 区分首次披露和修订。[利润表](https://tushare.pro/document/2?doc_id=33)、[资产负债表](https://tushare.pro/document/2?doc_id=36)、[现金流量表](https://tushare.pro/document/2?doc_id=44)、[财务指标](https://tushare.pro/document/2?doc_id=79) |
| `forecast`、`express` | 普通版 2000；全市场 `_vip` 版 5000 | 随公司披露更新 | 业绩预告/快报是研究事件候选，同时其数值字段形成数据观测。[业绩预告](https://tushare.pro/document/2?doc_id=45)、[业绩快报](https://tushare.pro/document/2?doc_id=46) |
| `repurchase`、`stk_holdertrade`、`share_float` | 2000/2000/低门槛；单次上限分别未统一公开/3000/6000 | 每日或定期更新 | 回购、增减持、解禁先作为结构化事件候选；需要对同一方案的状态变化去重。[回购](https://tushare.pro/document/2?doc_id=124)、[增减持](https://tushare.pro/document/2?doc_id=175)、[解禁](https://tushare.pro/document/2?doc_id=160) |
| `stk_surv` | 5000 积分；单次 100，可分页 | 历史起点及更新时间未公开 | 机构调研记录是高价值事件候选；当前仓库尚未接入。[官方文档](https://tushare.pro/document/2?doc_id=275) |
| `anns_d` | **独立公告权限**；单次 2000，可按日期循环 | 权限表称 10 年以上历史、500 次/分钟 | 公告标题与 PDF URL 是公司研究事件的首要证据；15000 积分本身不包含。[官方文档](https://tushare.pro/document/2?doc_id=176) |

**核定：** 公司结构化数据覆盖强；若没有独立公告权限或 Minishare 公告商业授权，研究事件无法建立完整的一手公告证据链。

#### 4. 新闻与政策

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| TuShare `news` | **独立新闻权限**；单次 1500 | 接口页称 6 年以上历史 | 快讯事件候选；15000 积分不包含。[官方文档](https://tushare.pro/document/2?doc_id=143) |
| TuShare `major_news` | **独立新闻权限**；单次 400 | 接口页称 8 年以上历史 | 长新闻事件候选；保留原始来源和 URL。[官方文档](https://tushare.pro/document/2?doc_id=195) |
| TuShare `cctv_news` | **独立新闻权限**；可按日循环 | 2017 年起 | 宏观与政策背景事件候选，不应机械映射到个股。[官方文档](https://tushare.pro/document/2?doc_id=154) |
| TuShare `npr` | **独立政策权限**；单次 500；权限表称每日一次 | 官方未给统一历史起点 | 政策原文、发文机构、文号及主题形成可追溯政策事件候选。[官方文档](https://tushare.pro/document/2?doc_id=406) |
| TuShare `monetary_policy` | **独立权限**；单次 1000 | 2001 年起，季度四篇 | 货币政策报告原文和 PDF 形成宏观事件候选；不是月度实时数据。[官方文档](https://tushare.pro/document/2?doc_id=465) |

**核定：** TuShare 15000 积分本身不提供新闻、公告、政策正文。MVP 可把 Minishare 作为这些内容的技术主源，但商业授权和稳定性核验必须先完成。

#### 5. 预期变化

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| `report_rc` 卖方盈利预测 | 2000 仅试用；8000 正式；10000+ 无总量限制；单次 3000 | 2010 年起；每日约 19:00-22:00 | 15000 可全量。保存每次快照后，由代码计算 EPS、净利润、评级和目标价变化，生成“预期变化数据观测”；接口本身不是修订事件流。[官方文档](https://tushare.pro/document/2?doc_id=292) |
| `broker_recommend` | 当前接口页称 6000 积分；单次 1000 | 一般每月 1-3 日更新当月数据 | 月度观点/共识辅助，不能替代研究依据。[官方文档](https://tushare.pro/document/2?doc_id=267) |
| `research_report` | **独立研报权限**；单次 1000、每天总量不限 | 2017-01-01 起；每日两次 | 标题、机构、作者、分类和链接可形成研报发布事件；正文展示与再分发必须按授权合同处理。[官方文档](https://tushare.pro/document/2?doc_id=415) |

**核定：** 15000 积分已经能做好结构化卖方预期变化；研报正文不是积分附赠能力。

#### 6. 事件日历

| 能力 | 权限与限量 | 更新/历史 | 研究对象与结论 |
| --- | --- | --- | --- |
| `trade_cal` | 2000 积分 | 接口页未公开固定更新频率和 A 股起点 | 交易日与调度基础，不是研究事件。[官方文档](https://tushare.pro/document/2?doc_id=26) |
| `disclosure_date` | 2000 积分；单次 6000、总量不限 | 全历史、定期更新 | 财报预计、实际和修订日期进入事件日历；修改日期本身可成为候选事件。[官方文档](https://tushare.pro/document/2?doc_id=162) |
| `dividend`、`share_float`、`new_share` | 均为积分接口 | 分红实时/解禁定期/IPO 约 19:00；各自历史范围不同 | 覆盖除权派息、解禁、IPO 等已知催化。[分红](https://tushare.pro/document/2?doc_id=103)、[解禁](https://tushare.pro/document/2?doc_id=160)、[IPO](https://tushare.pro/document/2?doc_id=123) |
| `cn_schedule` | 2000 积分；单次 3000 | 持续更新 | 覆盖国家统计局、央行等中国经济数据发布日期。[官方文档](https://tushare.pro/document/2?doc_id=461) |
| `eco_cal` | 2000 积分；单次仅 100 | 历史起点及固定更新时间未公开 | 全球财经日历需按窗口分页，并对低可信预告做修订处理。[官方文档](https://tushare.pro/document/2?doc_id=233) |

官方目录未发现结构化“股东大会日历”接口。可从公告标题/正文抽取，但公告是独立权限，抽取结果必须指向原 PDF，并允许后续修订。

## Minishare 当前能力与边界

### 官方资讯接口

| 接口 | 官方能力 | 公开限制/历史 | 建议归属 |
| --- | --- | --- | --- |
| `news` | 新浪财经、华尔街见闻、同花顺、财联社、东方财富快讯，可按来源筛选 | 默认/最大 1500，支持 `limit/offset`；官方未公开历史起点、调用频次和 SLA | 研究事件候选。[官方文档](https://minidoc.pages.dev/#news) |
| `major_news` | 长新闻，返回标题、来源、URL 和正文 | 官方未公开单次上限、历史起点、调用频次和 SLA | 研究事件候选，优先保留原文 URL。[官方文档](https://minidoc.pages.dev/#major_news) |
| `cctv_news` | 按日获取 CCTV 新闻 | 2020 年起；未公开频次和 SLA | 宏观/政策研究事件候选。[官方文档](https://minidoc.pages.dev/#cctv_news) |
| `anns_d` | A 股公告标题和详情 URL，按日期全市场或单股区间查询 | 2023 年起实时更新，另称有 2012-2022 CSV；单次 2000、可分页 | 公司研究事件候选及证据入口。[官方文档](https://minidoc.pages.dev/#anns_d) |
| `npr` | 国家政策法规，含原文、文号、机构和主题 | 2020 年起；单次最多 400 | 政策研究事件候选。[官方文档](https://minidoc.pages.dev/#npr) |
| `monetary_policy` | 央行货币政策执行报告及 PDF/HTML | 2001 年起，每年四篇；单次 1000 | 宏观研究事件候选。[官方文档](https://minidoc.pages.dev/#monetary_policy) |
| `research_report` | 个股、行业、宏观券商研报元数据和 PDF URL | 2021 年起；每日增量；未公开单次上限 | 研报发布事件和预期变化辅助证据。[官方文档](https://minidoc.pages.dev/#research_report) |
| `irm_qa_sh` / `irm_qa_sz` | 沪深上市公司董秘问答 | 沪市 2023 年起、深市 2021 年起；单次 1000、可分页 | 公司回应事件候选；提问内容不能当公司事实。[官方文档](https://minidoc.pages.dev/#irm_qa_sh) |

### 行情能力不应直接替代 TuShare 主干

Minishare 还公开了 `rt_k`/`rt_k_ms` 实时日线、`rt_min_ms`/`rt_min_daily_ms` 实时分钟和 `stk_mins` 历史分钟等接口。[实时日线文档](https://minidoc.pages.dev/#rt-k)、[实时分钟文档](https://minidoc.pages.dev/#rt-min)、[历史分钟文档](https://minidoc.pages.dev/#stk-mins)

但当前不能把它们视为已核定的生产主源：

- 官方实时分钟页明确数据基于券商 3 秒快照计算，可能有少量误差且不含集合竞价；这限制了它作为精确交易事实的用途。[实时分钟文档](https://minidoc.pages.dev/#rt-min)
- 官方没有公开订阅权限价格、服务端限流、稳定性 SLA、历史修订政策或商业再分发条款。[Minishare 官方文档](https://minidoc.pages.dev/)
- AlphaFlow 的目标明确把 Minishare 定位为资讯来源；在没有专项质量对账前，结构化市场数据仍应以 TuShare/交易所口径为主，Minishare 行情只可作为待校准备选。

### Minishare 许可结论

官方 SDK 0.1009.0 的包元数据声明 MIT License，首页指向 [Jasonmin/minishare](https://github.com/Jasonmin/minishare)，但该仓库当前为空且未提供单独的数据许可。MIT 只覆盖 SDK 软件本身，不能推导出新闻、公告、研报、行情或 PDF 的商业展示和再分发权。[SDK 包](https://minidoc.pages.dev/packages/minishare/minishare-0.1009.0-py3-none-any.whl)

因此，在拿到 Minishare 书面确认前应采用最保守边界：

1. 只在内部开发环境使用，不对用户输出大段原文、全量表格或可下载数据集。
2. 产品只保存最小必要的证据片段、来源名、时间、哈希和原文链接；是否允许长期缓存仍需合同确认。
3. 合同至少明确原始内容、结构化字段、LLM 衍生摘要、站内展示、外部消息推送、用户数量、缓存期限、删除义务和供应链版权责任。

## 数据源到研究对象的约束矩阵

| 输入 | 规范化结果 | 能否直接成为研究事件 | 分发约束 |
| --- | --- | --- | --- |
| 行情、估值、资金、两融、热榜、卖方预测快照 | 数据观测 | 否。异常、涨跌、热度或资金变化只触发核查 | 可进入工作台；只有与现实变化证据合并后才参与事件分发 |
| 公司公告、业绩预告/快报、回购/减持/解禁状态 | 研究事件候选 + 相关数据观测 | 经同一方案去重、状态增量和证据校验后可以 | 关键事实必须引用公告/结构化记录；更正或撤回要保留修订链 |
| 新闻快讯、长新闻、CCTV | 研究事件候选 | 经跨来源去重、实体关联和现实变化判断后可以 | LLM 只能引用输入证据；普通波动解读不得进入事件流 |
| 政策法规、货币政策报告、宏观日程 | 政策/宏观事件候选 | 发布或修订构成事件；日程本身只是未来催化 | 区分发布日期、实施日期、预告日期和实际公布日期 |
| 券商预测、月度金股、研报元数据 | 预期数据观测或研报发布候选 | 单条观点不自动成为重要事件；代码先计算与上一快照的增量 | 明确“卖方观点”而非公司事实，原研报展示受授权限制 |
| 董秘问答 | 公司回应候选 | 只有回答包含新增、可验证的信息时才可能成为事件 | 区分投资者提问与公司回答；提问不能作为事实证据 |

LLM 在 MVP 阶段可以给重要性、置信度、相关性和信息增量四项评分，但输入必须包含规范化证据，输出必须是“分数 + 分项依据 + 引用证据 + 不确定性”。最终分发由代码执行，且先通过 entitlement 检查。

## 当前适配器现状与缺口

### 已有基础

- TuShare 统一 provider 已覆盖日/周/月线、每日指标、指数/申万/THS、资金流、龙虎榜、公司行动、财务、业绩事件、卖方预测、基金、转债和部分宏观利率字段。[`tushare_provider.py`](../../python_services/app/data_providers/tushare_provider.py)
- Minishare 低层客户端已标准化快讯、长新闻和 CCTV 三源，生成内容哈希与来源条目 ID；三源日批次并发拉取，设置 15 秒总等待并允许部分源失败。[`client.py`](../../python_services/app/providers/minishare/client.py)、[`news.py`](../../python_services/app/providers/minishare/news.py)
- 网关已有短缓存和 stale 窗口，首页相关链路也已有快照化思路。[`cache_policy.py`](../../python_services/app/policies/cache_policy.py)、[ADR 0001](../adr/0001-homepage-runtime-and-generator-seam.md)

### 必须补齐的缺口

1. **权限目录模型错误。** 当前能力目录主要用 `TUSHARE_CREDITS` 推断可用性，无法表达独立权限、商业授权、第三方版权或接口试用态；`liveProbe` 也固定为 `false`。[`schedule_capability_catalog.py`](../../python_services/app/services/schedule_capability_catalog.py)
2. **部分积分门槛已与官方当前文档不一致。** 当前代码把 `ths_hot`、`limit_list_ths` 和多类资金流统一标为 5000，官方当前页分别为 6000、8000、6000；`broker_recommend` 和 `report_rc` 默认落到 2000，也没有表达“试用/正式”差异。15000 账户暂不受阻，但配置会误导其他环境。[能力目录](../../python_services/app/services/schedule_capability_catalog.py)
3. **文档 URL 生成无效。** 当前以数据集名拼入 `doc_id`，而 TuShare `doc_id` 是数字；例如 `doc_id=daily` 并不是规范接口页。需要显式接口注册表。[能力目录](../../python_services/app/services/schedule_capability_catalog.py)
4. **六类信息域仍有白名单缺口。** 当前 TuShare `RAW_DATASET_FIELDS` 没有 `anns_d`、`stk_surv`、`npr`、`monetary_policy`、`research_report`、`cn_schedule`、`eco_cal`、`dividend` 以外的完整日历扩展，也没有 `rt_k`；`rt_min` 字段为空并被能力目录排除。[`tushare_provider.py`](../../python_services/app/data_providers/tushare_provider.py)
5. **Minishare 只接入三类新闻。** 公告、政策、货币政策、研报和董秘问答均未适配，无法构成公司/政策事件的一手补充源。[`client.py`](../../python_services/app/providers/minishare/client.py)
6. **快讯分页不完整。** 当前一般新闻召回最多请求一页 1500 条，日批次只取 750 条；没有持续使用 `offset` 拉到目标数据截止点，高新闻量日期可能静默漏数。[`news.py`](../../python_services/app/providers/minishare/news.py)
7. **通用定时查询不适合作为全量采集器。** 当前统一限制最多返回 500 行、最大回看 365 天，而全市场日线/指标通常约 6000 行，公告与历史回补也需分页。应把交互查询上限和后台分片采集能力分开。[`schedule_capability_catalog.py`](../../python_services/app/services/schedule_capability_catalog.py)
8. **缓存策略与上游节奏没有绑定。** 当前新闻雷达 fresh TTL 为 1 小时、热力图为 6 小时、资金概览为 6 小时，且没有按数据集的预计可用时间与目标数据截止点配置；这不能直接满足紧急提醒。[`cache_policy.py`](../../python_services/app/policies/cache_policy.py)
9. **尚无统一 entitlement 与 lineage。** 缺少 `permission_kind`、`contract_scope`、`third_party_owner`、`row_limit`、`rpm`、`daily_limit`、`published_update_window`、`observed_lag` 和授权到期日；研究对象也尚未统一携带证据修订链。
10. **官方文档自身存在动态和冲突。** 例如部分接口在总说明与接口页的门槛不同。实现不能把本报告常量硬编码为永久事实，应以显式注册表、权限中心复核和只读实测共同决定状态。[TuShare 权限表](https://tushare.pro/document/1?doc_id=290)

## 对产品规格的直接约束

1. **盘前**可以稳定使用上一交易日市场结构、昨晚资金/龙虎榜/卖方预测、当日公告/新闻和经济日程；每项标注源时间和完整性。
2. **盘中**若未购买并校准实时权限，只展示来源实际能提供的低频更新，不承诺两分钟端到端时效，不用日线快照伪装实时。
3. **盘后**以 TuShare 15000 积分数据为结构化主干，按各接口公布窗口并发采集；同一批次允许部分完成并公开缺失源。
4. **前瞻日历**首批覆盖财报披露、分红、解禁、IPO、宏观数据；股东大会需从授权公告中抽取，明确为派生日历。
5. **收件箱和外部推送**只能发送已经通过商业授权、证据质量和四项评分门槛的内容；外部消息尽量只放标题、理由和站内链接。
6. **上线 go/no-go 门**是取得 TuShare 与 Minishare 的书面机构/商业授权，而不是完成接口开发。合同必须明确 LLM 加工结果是否属于允许的衍生使用。

## 建议的核定后数据源分工

| 优先级 | 数据源 | 首要职责 | 前置条件 |
| --- | --- | --- | --- |
| P0 | TuShare 积分接口 | 盘后结构化数据观测、公司财务与行动、卖方预期、事件日历 | 机构/商业许可；按接口限流、分片和目标数据截止点采集 |
| P0 | Minishare 资讯接口 | 新闻、公告、政策、研报元数据、董秘问答的研究事件候选 | 书面商业与再分发许可；分页、去重、来源和稳定性实测 |
| P1 | TuShare 独立公告/新闻/政策权限 | Minishare 的一手补充或容灾源 | 单独开通 + 商业许可 + 跨源版权确认 |
| P1 | TuShare 独立实时行情 | 盘中数据观测 | 独立购买、延迟/完整性压测和降级策略 |
| 待定 | Minishare 实时/分钟行情 | 备选盘中源或对账源 | 授权、限流、SLA、误差、集合竞价和历史修订全部核定 |

## 研究限制与后续验证

- 本报告没有使用账户 Token 做生产式压力测试，不能给出真实 p95、丢包率、峰值限流或上游故障率。
- Minishare 官方没有公开完整服务条款、价格表、限流和 SLA；这些不是可由代码或 SDK 许可证推断的事实。
- TuShare 文档会动态更新且个别页面存在门槛冲突；实施时需增加自动/人工复核日期，并保存账户权限中心截图或只读探测结果。
- 所有“实时”“盘后更新”均是供应方描述，不构成 AlphaFlow 对用户的承诺。

只有在完成商业授权和实际数据截止点基准测试后，才应把具体数据源写入可承诺的服务时效表。

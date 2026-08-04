# admin 演示账号投研收藏对象调研

> 调研日期：2026-08-04  
> 范围：本机演示数据，不修改数据库或业务代码。本文中的对象选择只用于展示个性化信号覆盖，不构成证券评价、收益预测或投资建议。

## 结论摘要

建议为 `admin` 准备：

- **8 个收藏公司**：宁德时代、比亚迪、中芯国际、工业富联、恒瑞医药、贵州茅台、招商银行、紫金矿业。
- **8 个收藏行业**：按“申万 2021 一级行业”保存电力设备、汽车、电子、计算机、医药生物、食品饮料、银行、有色金属。
- **1 个包含 10 只股票的自选股列表**：在上述 8 家公司基础上增加阳光电源、中国海油。

这组对象能在同一账号中同时形成新能源产业链、半导体与 AI 算力、创新药、消费、金融、资源品和公用事业信号，名称与代码容易识别，且交易所公告、公司投资者关系材料和主管部门信息均较丰富。它适合演示“公司直接命中、行业传播、上下游扩散、宏观主题关联和不同风格对象比较”，但不应把它解释成推荐组合。

## 这些收藏在产品中如何被使用

### 1. 首页个性化清单

`resolveHomePageSelection` 会分别读取当前用户最近更新的一个自选股、一个未归档收藏公司和一个未归档收藏行业，形成首页个性化清单并计算指纹。三类对象任意存在即标记为 `personalized`。收藏及自选股的创建、修改会触发首页重新生成。

这意味着演示灌库时不仅要考虑“放哪些对象”，还要控制 `updatedAt`：**最后更新的公司、行业和自选股会成为首屏代表信号**。建议最后更新宁德时代、电力设备和下文的“跨行业研究观察池”。

来源：[`web/server/application/homepage/home-page-selection.ts`](../../web/server/application/homepage/home-page-selection.ts)、[`web/server/api/routers/research-target.ts`](../../web/server/api/routers/research-target.ts)、[`web/server/api/routers/watchlist.ts`](../../web/server/api/routers/watchlist.ts)。

### 2. 个性化研究雷达、研究收件箱和定时简报

收藏公司、收藏行业和自选股**不会自动成为研究关注**。系统只把它们列为可选导入项：

- 收藏公司导入为 `COMPANY`，键为 6 位股票代码；
- 收藏行业导入为 `INDUSTRY`，键为 `来源:名称`；
- 自选股不是作为列表整体导入，而是将列表内每只股票展开成 `COMPANY` 候选；同代码候选会去重。

用户明确导入后，默认的常规关注可影响个性化研究雷达、研究收件箱和定时简报；只有用户主动提升为重点关注，并同时满足系统的重要性、置信度和信息增量门槛，才具备紧急提醒候选资格。行业关注对下级公司只传播较弱相关性，不会自动把成分公司变为关注对象。

因此，**仅给数据库增加收藏对象可以丰富首页和可导入候选，但不会直接开启研究雷达主动分发**。完整演示还需要在页面上明确执行一次“导入研究关注”，这也正好展示产品的显式同意设计。

来源：[`CONTEXT.md`](../../CONTEXT.md)、[`docs/adr/0009-explicit-research-preference-snapshot.md`](../adr/0009-explicit-research-preference-snapshot.md)、[`web/server/infrastructure/research-preference/prisma-research-preference-repository.ts`](../../web/server/infrastructure/research-preference/prisma-research-preference-repository.ts)。

### 3. 影响分析和 Agent 上下文

影响分析会读取最近更新的一条自选股、最多 100 个收藏公司和最多 20 个收藏行业，并把它们合并为公司、行业目标，供新闻影响映射和优先级判断使用。收藏公司和行业按创建时间参与优先级，自选股按列表更新时间参与优先级。Agent 的内部工具也可以读取当前用户的收藏概要和自选股成员、备注、标签；定时任务搭建器会把三类对象作为用户可引用范围。

因此，备注和标签应该描述“为什么观察”和“希望展示什么关联”，而不是写买卖结论。

来源：[`web/server/application/intelligence/impact-mapping-service.ts`](../../web/server/application/intelligence/impact-mapping-service.ts)、[`agent_runtime/src/tool-policy.ts`](../../agent_runtime/src/tool-policy.ts)、[`web/server/application/scheduled-task/scheduled-task-setup-service.ts`](../../web/server/application/scheduled-task/scheduled-task-setup-service.ts)。

### 4. 自选股的独立操作用途

自选股仍是股票集合、候选池和操作输入，可直接进入：

- 筛选工作台；
- 个股或组合择时研究；
- 组合风险诊断；
- 候选池管理与按标签过滤。

因此自选股应比收藏公司稍宽，保留用于比较的上下游和防御性对象；如果两者完全重复，筛选和组合演示会显得单调。

来源：[`docs/plans/design/research_target_ref.md`](../plans/design/research_target_ref.md)、[`web/app/watchlists/watchlist-action-links.ts`](../../web/app/watchlists/watchlist-action-links.ts)、[`web/server/domain/screening/aggregates/watch-list.ts`](../../web/server/domain/screening/aggregates/watch-list.ts)。

## 数据模型与写入约束

| 对象 | 必填/唯一约束 | 可用元信息 | 演示写入注意事项 |
| --- | --- | --- | --- |
| 收藏公司 `SavedCompany` | `stockCode` 必须是 6 位数字；`companyName` 非空；同一用户 `stockCode` 唯一 | `reason`、`tags[]`、`metadata` | 当前契约只保存 6 位代码，不带 `.SZ/.SH` |
| 收藏行业 `SavedIndustry` | `name`、`source` 非空；同一用户 `(source, name)` 唯一 | `reason`、`tags[]`、`relatedCompanies[]`、`metadata` | 建议固定 `source = 申万2021一级行业`，避免来源名称漂移 |
| 自选股 `WatchList` | 列表名非空；股票代码长度为 6；股票名非空；同一列表内代码不可重复 | 列表描述；每只股票的 `note`、`tags[]` | 可以有多个列表，但首页只取最近更新的一个；演示先只建一个主列表最稳妥 |

来源：[`web/contracts/research-target.ts`](../../web/contracts/research-target.ts)、[`web/prisma/schema.prisma`](../../web/prisma/schema.prisma)、[`web/server/api/routers/watchlist.ts`](../../web/server/api/routers/watchlist.ts)。

## 推荐收藏公司

| 股票代码 | 公司 | 演示信号 | 建议标签 |
| --- | --- | --- | --- |
| `300750` | 宁德时代 | 动力电池、储能，上游锂资源与下游整车传播链清晰 | `动力电池`、`储能`、`全球化` |
| `002594` | 比亚迪 | 整车、电池、汽车电子，适合展示销量、车型、出海和供应链事件 | `新能源汽车`、`整车`、`出海` |
| `688981` | 中芯国际 | 晶圆代工、国产半导体产业链，适合关联设备、材料和终端需求 | `半导体`、`晶圆代工`、`国产化` |
| `601138` | 工业富联 | AI 服务器、网络设备与智能制造，适合展示算力基础设施主题 | `AI算力`、`服务器`、`智能制造` |
| `600276` | 恒瑞医药 | 研发管线、临床试验、获批和授权合作等公开事件类型丰富 | `创新药`、`研发管线`、`国际化` |
| `600519` | 贵州茅台 | 渠道、价格、分红和消费景气，提供与科技制造不同的基本面信号 | `白酒`、`消费`、`渠道` |
| `600036` | 招商银行 | 净息差、资产质量、财富管理和分红，补足金融与宏观利率链条 | `银行`、`财富管理`、`资产质量` |
| `601899` | 紫金矿业 | 铜、金等资源价格与海外矿山事件，连接新能源上游和宏观商品周期 | `铜金`、`资源品`、`海外项目` |

建议 `reason` 统一采用中性句式，例如：“演示动力电池、储能及上下游事件的个性化关联”，不要写“看好”“低估”“建议买入”等方向性措辞。

证券名称和交易场所可由交易所公司资料页核验：[深交所公司资料](https://www.szse.cn/certificate/individual/index.html?code=300750)、[上交所公司概况](https://www.sse.com.cn/assortment/stock/list/info/company/index.shtml?COMPANY_CODE=688981)。仓库当前 TuShare 股票池也包含上述全部代码：[`data/screening_stock_universe.json`](../../data/screening_stock_universe.json)。

## 推荐收藏行业

统一使用 `source = 申万2021一级行业`：

| 行业名称 | 关联公司建议 | 演示用途 |
| --- | --- | --- |
| 电力设备 | 宁德时代、阳光电源 | 电池、储能、光伏产业链及政策/供需传播 |
| 汽车 | 比亚迪 | 整车销量、车型、出口与零部件链条 |
| 电子 | 中芯国际、工业富联 | 半导体、消费电子、AI 硬件交叉关联 |
| 计算机 | 工业富联 | 补充 AI 算力、服务器和数字基础设施主题入口 |
| 医药生物 | 恒瑞医药 | 药品审评审批、临床、医保与授权合作事件 |
| 食品饮料 | 贵州茅台 | 消费景气、渠道库存、价格和分红观察 |
| 银行 | 招商银行 | 利率、净息差、资产质量和财富管理 |
| 有色金属 | 紫金矿业 | 铜金价格、矿山产量和新能源上游资源 |

TuShare `index_classify` 明确支持申万 2021 分类及 L1/L2/L3 层级；`index_member_all` 可用于核验行业成分，`sw_daily` 可提供行业日线观测。保存时保留版本和层级，避免只写模糊的“新能源”“AI”等跨口径主题。

来源：[TuShare 申万行业分类](https://tushare.pro/document/2?doc_id=181)、[申万行业成分](https://tushare.pro/document/2?doc_id=335)、[申万行业日线](https://tushare.pro/document/2?doc_id=327)。

## 推荐自选股

列表名建议：**跨行业研究观察池**  
描述建议：**用于演示筛选、组合研究和跨行业事件影响，不代表实际持仓或投资建议。**

| 股票代码 | 股票名称 | 建议备注 | 建议标签 |
| --- | --- | --- | --- |
| `300750` | 宁德时代 | 动力电池与储能链核心观察对象 | `新能源`、`电池`、`成长` |
| `002594` | 比亚迪 | 整车、动力电池与出海事件观察 | `新能源车`、`整车`、`出海` |
| `300274` | 阳光电源 | 逆变器和储能，与海外光伏需求关联 | `光伏`、`储能`、`出海` |
| `688981` | 中芯国际 | 晶圆代工与国产半导体供应链观察 | `半导体`、`国产化`、`成长` |
| `601138` | 工业富联 | AI 服务器、网络设备与制造需求观察 | `AI算力`、`服务器`、`成长` |
| `600276` | 恒瑞医药 | 管线、临床、获批和合作事件观察 | `创新药`、`研发`、`事件驱动` |
| `600519` | 贵州茅台 | 渠道、价格、消费景气和分红观察 | `消费`、`白酒`、`现金流` |
| `600036` | 招商银行 | 净息差、资产质量和财富管理观察 | `银行`、`利率`、`红利` |
| `601899` | 紫金矿业 | 铜金价格及海外矿山经营事件观察 | `资源品`、`铜金`、`周期` |
| `600938` | 中国海油 | 油价、产量、资本开支和能源安全观察 | `油气`、`能源`、`红利` |

这 10 只股票均存在于仓库当前的 TuShare 股票池。10 只也恰好匹配首页筹码观察最多读取 10 个代码的实现上限，避免列表尾部对象在首屏演示中被静默省略。公司公告与证券身份应优先以交易所页面核验；公司业务与定期报告可继续从公司官网投资者关系入口获取：

- [宁德时代](https://www.catl.com/)、[比亚迪](https://www.bydglobal.com/cn/index.html)、[阳光电源](https://www.sungrowpower.com/)
- [中芯国际](https://www.smics.com/)、[工业富联投资者关系](https://www.fii-foxconn.com/InvestorRelations)、[恒瑞医药](https://www.hengrui.com/)、[贵州茅台](https://www.moutaichina.com/)
- [招商银行投资者关系](https://www.cmbchina.com/cmbir/)、[紫金矿业](https://www.zijinmining.com/)、[中国海油](https://www.cnoocltd.com/)

## 为什么这组对象方便演示

1. **对象层次互补**：收藏公司代表长期研究档案；行业提供上位传播关系；自选股扩展出用于筛选和组合比较的股票，不是三份完全重复的数据。
2. **行业链条清晰**：宁德时代—比亚迪—阳光电源可展示新能源内部不同子链；中芯国际—工业富联可展示芯片、服务器和算力基础设施；紫金矿业可向新能源上游和宏观商品两侧传播。
3. **事件类型多样**：科技制造有产能、产品与供应链事件；医药有临床、获批和合作；消费有渠道和价格；银行有利率与资产质量；资源和公用事业有商品价格、产量、来水、电价和分红。
4. **宏观敏感度不同**：成长、周期、消费、金融和红利类对象同池存在，适合展示影响映射和组合风险差异，而不是只展示一个热门主题。
5. **一手信息入口稳定**：证券身份和公告可回到上交所/深交所，公司经营材料可回到公司投资者关系页面，产业政策和统计可回到工信部、国家能源局、国家药监局、国家金融监督管理总局。

主管部门入口：[工业和信息化部](https://www.miit.gov.cn/)、[国家能源局](https://www.nea.gov.cn/)、[国家药品监督管理局](https://www.nmpa.gov.cn/)、[国家金融监督管理总局](https://www.nfra.gov.cn/)。这些入口说明可获得的公开信息类型，不代表主管部门对上述公司的评价。

## 建议的演示写入顺序

1. 写入 8 个收藏行业，并填好 `relatedCompanies`。
2. 写入 8 个收藏公司，填入中性 `reason` 和标签。
3. 创建一个“跨行业研究观察池”，加入 10 只股票及备注/标签。
4. 最后依次更新宁德时代、电力设备、自选股列表，使它们成为首页最近更新的三类代表对象。
5. 登录页面检查三类收藏存在后，手动选择若干对象导入研究关注：可把宁德时代设为重点关注，其余保持常规关注，以便演示常规分发和紧急提醒资格的差异。导入动作必须由演示者明确确认，不能由灌库脚本替代。

## 边界与后续核验

- 已只读查询本机 PostgreSQL：当前只有一个名称为 `admin`、状态为 `ACTIVE` 的用户；其收藏公司、收藏行业、自选股和研究偏好均为空。报告未修改数据库，后续写入不存在现有收藏冲突，但仍建议使用事务和唯一约束保证重复执行安全。
- 数据模型保存 6 位股票代码；报告中的 `.SZ/.SH` 只用于外部证券身份说明，不应写入 `stockCode` 字段。
- 行业归属可能随分类版本调整。这里推荐的是演示用研究信号结构，实际 `relatedCompanies` 应在写入时用 TuShare `index_member_all` 再核验，不要把手工关联当成正式指数成分结论。
- TuShare 15000 积分足以调用申万行业分类和成分接口，但公告、新闻等可能有独立权限；具体数据可用边界见 [`docs/research/wayfinder-data-sources.md`](wayfinder-data-sources.md)。

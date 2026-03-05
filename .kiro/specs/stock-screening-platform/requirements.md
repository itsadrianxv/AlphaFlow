# 需求文档：股票筛选平台（Stock Screening Platform）

## 简介

本文档定义股票投研工作流定制化平台 MVP（P0）阶段的需求，聚焦于 Stock Screening Context（筛选上下文）。平台采用 T3 Stack（Next.js App Router + TypeScript + tRPC + Prisma + Tailwind CSS）作为主体架构，结合 Python FastAPI 微服务提供金融数据接口（AkShare），遵循 DDD 分层架构原则。

MVP 范围覆盖三大核心功能：
- FR-1：层层迭代筛选引擎
- FR-2：AI 驱动的快速行业认知（简化版）
- FR-3：概念可信度验证（简化版）

## 术语表

- **Screening_Engine（筛选引擎）**: 负责执行股票筛选、评分、排序的核心系统组件
- **ScreeningStrategy（筛选策略）**: 聚合根，定义筛选条件和评分配置的完整策略对象
- **ScreeningSession（筛选会话）**: 聚合根，记录某次筛选执行的结果快照
- **WatchList（自选股列表）**: 聚合根，用户管理关注股票的列表
- **FilterGroup（筛选条件组）**: 实体，支持 AND/OR/NOT 递归嵌套的条件组
- **FilterCondition（筛选条件）**: 值对象，单个筛选条件（如 ROE > 15%）
- **IndicatorField（指标字段）**: 枚举，定义所有可用的筛选和评分指标
- **IndicatorValue（指标值）**: 值对象，Tagged Union 模式的指标值（NumericValue、TextValue、ListValue、RangeValue、TimeSeriesValue）
- **ScoringConfig（评分配置）**: 值对象，定义评分权重和归一化方法
- **ScoredStock（带评分股票）**: 值对象，包含股票评分和指标明细
- **StockCode（股票代码）**: 共享内核值对象，A 股代码规范
- **tRPC_Router（tRPC 路由）**: 充当应用层入口，编排领域服务调用
- **Python_Data_Service（Python 数据服务）**: FastAPI 微服务，提供 AkShare 金融数据接口
- **IScoringService（评分服务）**: 领域服务接口，负责股票评分计算
- **IIndicatorCalculationService（指标计算服务）**: 领域服务接口，负责各类指标值计算
- **IMarketDataRepository（市场数据仓储）**: 共享内核接口，提供市场股票数据查询
- **IHistoricalDataProvider（历史数据提供者）**: 领域层接口，提供股票历史指标数据

## 需求

### 需求 1：筛选策略管理

**用户故事：** 作为私募投资者，我希望创建、编辑和管理筛选策略，以便复用和迭代调整筛选条件。

#### 验收标准

1. WHEN 用户提供策略名称、筛选条件组和评分配置, THE Screening_Engine SHALL 创建一个新的 ScreeningStrategy 并持久化到数据库
2. WHEN 用户修改已有策略的筛选条件或评分配置, THE Screening_Engine SHALL 更新该 ScreeningStrategy 并验证所有业务不变量（名称非空、至少一个有效条件、权重之和为 1.0）
3. WHEN 用户将策略标记为模板, THE Screening_Engine SHALL 将 ScreeningStrategy 的 is_template 设为 true 并允许其他策略基于该模板克隆
4. WHEN 用户基于模板创建新策略, THE Screening_Engine SHALL 深拷贝模板的 FilterGroup 和 ScoringConfig 到新策略中
5. IF 用户提交的 ScoringConfig 权重之和不等于 1.0, THEN THE Screening_Engine SHALL 拒绝该操作并返回包含具体偏差值的验证错误
6. IF 用户提交的 FilterGroup 不包含任何有效条件, THEN THE Screening_Engine SHALL 拒绝该操作并返回"至少需要一个筛选条件"的错误
7. WHEN 用户删除一个 ScreeningStrategy, THE Screening_Engine SHALL 移除该策略但保留所有关联的 ScreeningSession 不受影响

### 需求 2：筛选条件构建

**用户故事：** 作为私募投资者，我希望通过结构化方式构建复杂的筛选条件组合（AND/OR/NOT 嵌套），以便精确定义筛选逻辑。

#### 验收标准

1. THE FilterGroup SHALL 支持 AND、OR、NOT 三种逻辑运算符的递归嵌套组合
2. WHEN 创建 FilterCondition 时, THE Screening_Engine SHALL 验证 IndicatorField 与 IndicatorValue 的类型匹配（数值型指标对应 NumericValue，文本型指标对应 TextValue）
3. WHEN 创建 FilterCondition 时, THE Screening_Engine SHALL 验证 ComparisonOperator 与 IndicatorValue 类型的兼容性（GREATER_THAN 仅适用于 NumericValue，IN 仅适用于 ListValue，BETWEEN 仅适用于 RangeValue）
4. WHEN FilterGroup 的逻辑运算符为 NOT 时, THE FilterGroup SHALL 仅允许包含一个子元素（一个条件或一个子组）
5. THE FilterGroup SHALL 提供 to_dict 序列化方法和 from_dict 反序列化方法，以支持 JSON 格式的持久化和 API 传输
6. THE FilterCondition SHALL 提供 to_dict 序列化方法和 from_dict 反序列化方法，以支持 JSON 格式的持久化和 API 传输

### 需求 3：筛选执行与评分

**用户故事：** 作为私募投资者，我希望执行筛选策略并获得评分排序后的结果，以便快速定位高价值标的。

#### 验收标准

1. WHEN 用户执行一个 ScreeningStrategy, THE Screening_Engine SHALL 对候选股票列表依次应用 FilterGroup 匹配、IScoringService 评分和降序排序，生成 ScreeningResult
2. WHEN FilterCondition 评估某只股票时, THE IIndicatorCalculationService SHALL 根据 IndicatorField 的 category 路由计算：BASIC 类型直接从 Stock 获取，TIME_SERIES 类型从 IHistoricalDataProvider 获取历史数据计算，DERIVED 类型由基础指标公式计算
3. WHEN 股票的某个指标值缺失（为 null）时, THE FilterCondition SHALL 将该股票视为不匹配该条件（返回 false）
4. WHEN IScoringService 对股票评分时, THE IScoringService SHALL 使用 MIN_MAX 归一化方法将每个指标值映射到 0-1 区间，再按 ScoringConfig 中的权重加权求和得到总分
5. WHEN 股票的某个评分指标值缺失时, THE IScoringService SHALL 将该指标的归一化得分设为 0
6. WHEN 筛选执行完成后, THE Screening_Engine SHALL 创建 ScreeningSession 保存执行结果，其中前 50 只股票保存完整 ScoredStock 信息，其余股票仅保存 StockCode
7. THE ScreeningSession SHALL 保存执行时的 FilterGroup 快照和 ScoringConfig 快照，确保即使原策略被修改或删除，会话仍可复现当时的筛选逻辑

### 需求 4：筛选历史管理

**用户故事：** 作为私募投资者，我希望查看和管理筛选执行历史，以便回顾和对比不同时间的筛选结果。

#### 验收标准

1. WHEN 用户查看筛选历史, THE Screening_Engine SHALL 按执行时间降序返回 ScreeningSession 列表
2. WHEN 用户查看某个策略的执行历史, THE Screening_Engine SHALL 返回该 StrategyId 关联的所有 ScreeningSession
3. WHEN 用户查看某个 ScreeningSession 的详情, THE Screening_Engine SHALL 返回 top_stocks 的完整 ScoredStock 信息以及 filters_snapshot 和 scoring_config_snapshot
4. WHEN 用户删除一个 ScreeningSession, THE Screening_Engine SHALL 移除该会话记录

### 需求 5：自选股列表管理

**用户故事：** 作为私募投资者，我希望将筛选结果中感兴趣的股票加入自选股列表，以便持续跟踪和管理。

#### 验收标准

1. WHEN 用户创建自选股列表并提供名称, THE Screening_Engine SHALL 创建一个新的 WatchList
2. WHEN 用户向 WatchList 添加股票, THE WatchList SHALL 记录 StockCode、股票名称、添加时间，并支持可选的备注和标签
3. IF 用户向 WatchList 添加已存在的股票, THEN THE WatchList SHALL 拒绝该操作并返回 DuplicateStockError
4. WHEN 用户从 WatchList 移除股票, THE WatchList SHALL 删除对应的 WatchedStock 记录
5. WHEN 用户按标签查询 WatchList 中的股票, THE WatchList SHALL 返回所有包含该标签的 WatchedStock

### 需求 6：市场数据集成

**用户故事：** 作为私募投资者，我希望系统能从金融数据源获取全市场股票数据，以便筛选引擎有完整的候选池。

#### 验收标准

1. THE Python_Data_Service SHALL 通过 AkShare 提供全市场 A 股股票代码列表的 HTTP API 接口
2. THE Python_Data_Service SHALL 通过 AkShare 提供按股票代码批量查询股票基础数据（行业、ROE、PE、PB、EPS、营收、净利润、负债率、市值等）的 HTTP API 接口
3. THE Python_Data_Service SHALL 通过 AkShare 提供按股票代码查询历史财务指标数据（最近 N 年）的 HTTP API 接口
4. WHEN T3 应用调用 Python_Data_Service 时, THE 基础设施层 HTTP Client SHALL 实现 IMarketDataRepository 和 IHistoricalDataProvider 接口，将 HTTP 响应映射为领域层的 Stock 实体和 IndicatorDataPoint 值对象
5. IF Python_Data_Service 返回错误或超时, THEN THE 基础设施层 HTTP Client SHALL 返回 DataNotAvailableError 并包含错误详情

### 需求 7：tRPC API 层

**用户故事：** 作为前端开发者，我希望通过 tRPC 端到端类型安全的 API 访问筛选功能，以便高效构建用户界面。

#### 验收标准

1. THE tRPC_Router SHALL 提供筛选策略的 CRUD 操作端点（create、update、delete、getById、list）
2. THE tRPC_Router SHALL 提供执行筛选策略的端点，接受 StrategyId 并返回 ScreeningResult
3. THE tRPC_Router SHALL 提供筛选历史的查询端点（listRecent、getByStrategy、getSessionDetail）
4. THE tRPC_Router SHALL 提供自选股列表的 CRUD 操作端点（create、delete、addStock、removeStock、list）
5. THE tRPC_Router SHALL 使用 Zod schema 对所有输入参数进行验证
6. WHEN tRPC_Router 接收到请求时, THE tRPC_Router SHALL 仅编排领域服务调用，不包含业务逻辑

### 需求 8：Prisma 数据模型

**用户故事：** 作为开发者，我希望通过 Prisma ORM 定义数据模型，以便类型安全地访问 PostgreSQL 数据库。

#### 验收标准

1. THE Prisma Schema SHALL 定义 ScreeningStrategy 模型，包含 id、name、description、filters（Json 类型）、scoringConfig（Json 类型）、tags（String 数组）、isTemplate（Boolean）、createdAt、updatedAt 字段，并关联 User
2. THE Prisma Schema SHALL 定义 ScreeningSession 模型，包含 id、strategyId、strategyName、executedAt、totalScanned、executionTime、topStocks（Json 类型）、otherStockCodes（String 数组）、filtersSnapshot（Json 类型）、scoringConfigSnapshot（Json 类型）字段
3. THE Prisma Schema SHALL 定义 WatchList 模型，包含 id、name、description、stocks（Json 类型）、createdAt、updatedAt 字段，并关联 User
4. THE Prisma Schema SHALL 与现有的 User、Account、Session、VerificationToken 认证模型兼容共存

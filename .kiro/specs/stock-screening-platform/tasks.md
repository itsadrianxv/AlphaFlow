# Implementation Plan: 股票筛选平台（Stock Screening Platform）

## Overview

基于 DDD 分层架构，自底向上实现股票筛选平台 MVP。从领域层核心值对象和枚举开始，逐步构建实体、聚合根、领域服务，再实现基础设施层（Prisma Repository、Python HTTP Client），最后接入 tRPC 应用层和 Python FastAPI 数据服务。每个阶段通过属性基测试和单元测试验证正确性。

## Tasks

- [ ] 1. 领域层：枚举、值对象与基础类型
  - [x] 1.1 创建枚举定义文件
    - 创建 `src/server/domain/screening/enums/indicator-field.ts`：定义 IndicatorField 枚举（ROE、PE、PB、EPS、REVENUE、NET_PROFIT、DEBT_RATIO、MARKET_CAP 等），每个字段标注 category（BASIC / TIME_SERIES / DERIVED）和 valueType（NUMERIC / TEXT）
    - 创建 `src/server/domain/screening/enums/comparison-operator.ts`：定义 ComparisonOperator 枚举（GREATER_THAN、LESS_THAN、EQUAL、NOT_EQUAL、IN、NOT_IN、BETWEEN、CONTAINS）
    - 创建 `src/server/domain/screening/enums/logical-operator.ts`：定义 LogicalOperator 枚举（AND、OR、NOT）
    - 创建 `src/server/domain/screening/enums/indicator-category.ts`：定义 IndicatorCategory 枚举（BASIC、TIME_SERIES、DERIVED）
    - 创建 `src/server/domain/screening/enums/index.ts` 统一导出
    - _Requirements: 2.2, 2.3_

  - [x] 1.2 创建 StockCode 共享内核值对象
    - 创建 `src/server/domain/screening/value-objects/stock-code.ts`
    - 实现 A 股代码规范验证（6 位数字，以 0/3/6 开头）
    - 实现 equals、toString 方法
    - _Requirements: 5.2_

  - [x] 1.3 创建 IndicatorValue Tagged Union 值对象
    - 创建 `src/server/domain/screening/value-objects/indicator-value.ts`
    - 定义 NumericValue、TextValue、ListValue、RangeValue、TimeSeriesValue 类型
    - 实现类型守卫函数（isNumericValue、isTextValue 等）
    - _Requirements: 2.2_

  - [x] 1.4 创建 ScoringConfig 值对象
    - 创建 `src/server/domain/screening/value-objects/scoring-config.ts`
    - 实现 validate 方法：权重之和 === 1.0（±0.001 精度）
    - 实现 toDict / fromDict 序列化方法
    - _Requirements: 1.5, 3.4_

  - [x] 1.5 创建 ScoredStock、WatchedStock、ScreeningResult 值对象
    - 创建 `src/server/domain/screening/value-objects/scored-stock.ts`：包含 stockCode、stockName、score、scoreBreakdown、indicatorValues、matchedConditions
    - 创建 `src/server/domain/screening/value-objects/watched-stock.ts`：包含 stockCode、stockName、addedAt、note、tags
    - 创建 `src/server/domain/screening/value-objects/screening-result.ts`：包含 matchedStocks、totalScanned、executionTime
    - 创建 `src/server/domain/screening/value-objects/index.ts` 统一导出
    - _Requirements: 3.1, 3.6, 5.2_

  - [x] 1.6 创建 Stock 实体
    - 创建 `src/server/domain/screening/entities/stock.ts`
    - 定义 Stock 接口和类，包含 code、name、industry、sector 及各指标字段
    - 实现 getValue(indicator: IndicatorField) 方法返回对应指标值或 null
    - _Requirements: 6.4_

  - [x] 1.7 创建领域异常类
    - 创建 `src/server/domain/screening/errors.ts`
    - 定义 InvalidStrategyError、DuplicateStockError、StockNotFoundError、InvalidFilterConditionError、ScoringError、IndicatorCalculationError、DataNotAvailableError
    - _Requirements: 1.5, 1.6, 5.3, 6.5_

- [ ] 2. 领域层：FilterCondition 与 FilterGroup
  - [x] 2.1 实现 FilterCondition 值对象
    - 创建 `src/server/domain/screening/value-objects/filter-condition.ts`
    - 实现构造时的类型验证：IndicatorField.valueType 与 IndicatorValue.type 匹配
    - 实现构造时的运算符兼容性验证：ComparisonOperator 与 IndicatorValue.type 兼容
    - 实现 evaluate(stock, calcService) 方法：null 值返回 false
    - 实现 toDict / fromDict 序列化方法
    - _Requirements: 2.2, 2.3, 2.6, 3.3_

  - [x] 2.2 编写 FilterCondition 构造验证属性基测试
    - **Property 3: FilterCondition 构造验证**
    - 使用 fast-check 生成随机 IndicatorField、ComparisonOperator、IndicatorValue 组合
    - 验证构造成功当且仅当类型匹配且运算符兼容
    - **Validates: Requirements 2.2, 2.3**

  - [x] 2.3 实现 FilterGroup 实体（递归结构）
    - 创建 `src/server/domain/screening/entities/filter-group.ts`
    - 实现 match(stock, calcService) 递归匹配：AND 全匹配、OR 任一匹配、NOT 取反
    - 实现 NOT 组约束：仅允许一个子元素
    - 实现 hasAnyCondition() 递归检查
    - 实现 countTotalConditions() 递归计数
    - 实现 toDict / fromDict 序列化（递归结构）
    - _Requirements: 2.1, 2.4, 2.5_

  - [x] 2.4 编写 FilterGroup 序列化往返属性基测试
    - **Property 4: FilterGroup 与 FilterCondition 序列化往返一致性**
    - 使用 fast-check letrec 生成随机递归 FilterGroup 树
    - 验证 fromDict(toDict(group)) 与原始 group 结构等价
    - **Validates: Requirements 2.5, 2.6**

  - [x] 2.5 编写 FilterGroup 递归匹配语义属性基测试
    - **Property 5: FilterGroup 递归匹配语义正确性**
    - 生成随机 FilterGroup 树和 Stock，验证 AND/OR/NOT 语义
    - **Validates: Requirements 2.1**

  - [x] 2.6 编写缺失指标值属性基测试
    - **Property 7: 缺失指标值导致条件不匹配**
    - 生成随机 FilterCondition 和指标值为 null 的 Stock
    - 验证 evaluate 返回 false
    - **Validates: Requirements 3.3**

- [x] 3. Checkpoint - 值对象与实体测试通过
  - 确保所有已编写的测试通过，如有问题请向用户确认。

- [ ] 4. 领域层：聚合根
  - [x] 4.1 实现 ScreeningStrategy 聚合根
    - 创建 `src/server/domain/screening/aggregates/screening-strategy.ts`
    - 实现 create 静态工厂方法，包含不变量验证（name 非空、filters 有条件、权重和为 1.0）
    - 实现 update 方法，修改后重新验证不变量
    - 实现 markAsTemplate / cloneWithModifications（深拷贝 FilterGroup 和 ScoringConfig）
    - 实现 execute(candidateStocks, scoringService, calcService) 编排筛选流程
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 3.1_

  - [x] 4.2 编写策略不变量属性基测试
    - **Property 1: 策略业务不变量验证**
    - 生成随机策略参数，验证不变量违反时操作被拒绝
    - **Validates: Requirements 1.2, 1.5, 1.6**

  - [x] 4.3 编写策略克隆深拷贝属性基测试
    - **Property 2: 策略克隆深拷贝独立性**
    - 生成随机策略，克隆后修改新策略，验证原策略不受影响
    - **Validates: Requirements 1.4**

  - [x] 4.4 实现 ScreeningSession 聚合根
    - 创建 `src/server/domain/screening/aggregates/screening-session.ts`
    - 实现 create 静态工厂方法：前 50 只保存完整 ScoredStock，其余仅保存 StockCode
    - 实现 getAllMatchedCodes、getStockDetail、getTopN、countMatched 方法
    - 保存 filtersSnapshot 和 scoringConfigSnapshot
    - _Requirements: 3.6, 3.7, 4.3_

  - [x] 4.5 编写 ScreeningSession 分层存储属性基测试
    - **Property 9: ScreeningSession 分层存储不变量**
    - 生成随机 ScreeningResult，验证 topStocks ≤ 50 且总数一致
    - **Validates: Requirements 3.6**

  - [x] 4.6 实现 WatchList 聚合根
    - 创建 `src/server/domain/screening/aggregates/watch-list.ts`
    - 实现 addStock（重复检查抛 DuplicateStockError）、removeStock、updateStockNote、updateStockTags
    - 实现 contains、getStocksByTag 方法
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.7 编写 WatchList 一致性属性基测试
    - **Property 10: WatchList 添加/移除/包含一致性**
    - 生成随机操作序列，验证 add→contains=true、remove→contains=false、重复 add 抛错
    - **Validates: Requirements 5.2, 5.3, 5.4**

  - [x] 4.8 编写 WatchList 标签过滤属性基测试
    - **Property 11: WatchList 标签过滤正确性**
    - 生成随机 WatchList 和标签，验证 getStocksByTag 返回结果的完整性和正确性
    - **Validates: Requirements 5.5**

- [ ] 5. 领域层：领域服务
  - [x] 5.1 定义 Repository 接口
    - 创建 `src/server/domain/screening/repositories/screening-strategy-repository.ts`
    - 创建 `src/server/domain/screening/repositories/screening-session-repository.ts`
    - 创建 `src/server/domain/screening/repositories/watch-list-repository.ts`
    - 创建 `src/server/domain/screening/repositories/market-data-repository.ts`
    - 创建 `src/server/domain/screening/repositories/historical-data-provider.ts`
    - 创建 `src/server/domain/screening/repositories/index.ts` 统一导出
    - _Requirements: 6.4_

  - [x] 5.2 实现 IIndicatorCalculationService 领域服务
    - 创建 `src/server/domain/screening/services/indicator-calculation-service.ts`
    - 定义接口和实现类
    - 实现路由逻辑：BASIC → stock.getValue、TIME_SERIES → IHistoricalDataProvider、DERIVED → 硬编码公式
    - _Requirements: 3.2_

  - [x] 5.3 实现 IScoringService 领域服务
    - 创建 `src/server/domain/screening/services/scoring-service.ts`
    - 定义接口和实现类
    - 实现 MIN_MAX 归一化：(value - min) / (max - min)，缺失值归一化得分为 0
    - 实现加权求和：score = Σ(归一化值 × 权重)
    - _Requirements: 3.4, 3.5_

  - [x] 5.4 编写评分排序属性基测试
    - **Property 6: 筛选结果按评分降序排列**
    - 生成随机股票列表和 ScoringConfig，验证结果按 score 降序
    - **Validates: Requirements 3.1**

  - [x] 5.5 编写评分归一化值域属性基测试
    - **Property 8: 评分归一化值域不变量**
    - 生成随机非空股票列表和 ScoringConfig，验证所有 score 和 scoreBreakdown 值在 [0, 1]
    - **Validates: Requirements 3.4**

- [ ] 6. Checkpoint - 领域层完整测试通过
  - 确保所有领域层测试通过，如有问题请向用户确认。

- [ ] 7. 数据层：Prisma Schema 与 Repository 实现
  - [x] 7.1 扩展 Prisma Schema
    - 在 `prisma/schema.prisma` 中新增 ScreeningStrategy、ScreeningSession、WatchList 模型
    - 在 User 模型中添加 strategies、screeningSessions、watchLists 关联字段
    - 添加必要的索引（userId、isTemplate、strategyId、executedAt、name）
    - 运行 `prisma db push` 同步数据库
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 7.2 实现 PrismaScreeningStrategyRepository
    - 创建 `src/server/infrastructure/screening/prisma-screening-strategy-repository.ts`
    - 实现 IScreeningStrategyRepository 接口：save、findById、delete、findAll、findTemplates、findByName
    - 处理 FilterGroup 和 ScoringConfig 的 JSON 序列化/反序列化
    - _Requirements: 1.1, 1.7_

  - [x] 7.3 实现 PrismaScreeningSessionRepository
    - 创建 `src/server/infrastructure/screening/prisma-screening-session-repository.ts`
    - 实现 IScreeningSessionRepository 接口：save、findById、delete、findByStrategy、findRecentSessions
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.4 实现 PrismaWatchListRepository
    - 创建 `src/server/infrastructure/screening/prisma-watch-list-repository.ts`
    - 实现 IWatchListRepository 接口：save、findById、delete、findAll、findByName
    - _Requirements: 5.1_

- [ ] 8. Python FastAPI 数据服务
  - [x] 8.1 搭建 Python FastAPI 项目结构
    - 创建 `python_services/app/main.py`：FastAPI 入口，注册路由，配置 CORS
    - 创建 `python_services/requirements.txt`：fastapi、uvicorn、akshare、pydantic
    - 创建 `python_services/app/__init__.py`
    - 创建 `python_services/app/routers/__init__.py`
    - 创建 `python_services/app/services/__init__.py`
    - _Requirements: 6.1_

  - [x] 8.2 实现 AkShare 数据适配器
    - 创建 `python_services/app/services/akshare_adapter.py`
    - 实现 get_all_stock_codes()：调用 AkShare 获取全市场 A 股代码列表
    - 实现 get_stocks_by_codes(codes)：批量查询股票基础数据
    - 实现 get_indicator_history(code, indicator, years)：查询历史财务指标
    - 实现 get_available_industries()：获取行业列表
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.3 实现 FastAPI 股票数据路由
    - 创建 `python_services/app/routers/stock_data.py`
    - 实现 GET /stocks/codes、POST /stocks/batch、GET /stocks/{code}/history、GET /stocks/industries
    - 使用 Pydantic 模型定义请求/响应 schema（StockData、IndicatorDataPoint）
    - 添加错误处理和超时保护
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.4 编写 Python 数据服务单元测试
    - 创建 `python_services/tests/test_stock_data.py`
    - 使用 pytest + httpx 测试 FastAPI 路由
    - Mock AkShare 调用，验证响应格式和错误处理
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 9. 基础设施层：Python 数据服务 HTTP Client
  - [x] 9.1 实现 PythonDataServiceClient
    - 创建 `src/server/infrastructure/screening/python-data-service-client.ts`
    - 实现 IMarketDataRepository 和 IHistoricalDataProvider 接口
    - 将 HTTP JSON 响应映射为领域层 Stock 实体和 IndicatorDataPoint 值对象
    - 实现超时处理和错误转换（DataNotAvailableError）
    - _Requirements: 6.4, 6.5_

  - [x] 9.2 编写 HTTP 响应映射属性基测试
    - **Property 12: HTTP 响应到领域对象映射正确性**
    - 使用 fast-check 生成随机有效 StockData JSON，验证映射后 Stock 实体字段正确
    - **Validates: Requirements 6.4**

- [ ] 10. Checkpoint - 基础设施层与数据服务测试通过
  - 确保所有基础设施层测试和 Python 服务测试通过，如有问题请向用户确认。

- [x] 11. 应用层：tRPC Router
  - [x] 11.1 实现 screening tRPC Router
    - 创建 `src/server/api/routers/screening.ts`
    - 实现策略 CRUD 端点：createStrategy、updateStrategy、deleteStrategy、getStrategy、listStrategies
    - 实现筛选执行端点：executeStrategy（编排 ScreeningStrategy.execute → ScreeningSession 创建）
    - 实现历史查询端点：listRecentSessions、getSessionsByStrategy、getSessionDetail、deleteSession
    - 使用 Zod schema 验证所有输入参数
    - 实现领域异常到 TRPCError 的映射
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [x] 11.2 实现 watchlist tRPC Router
    - 创建 `src/server/api/routers/watchlist.ts`
    - 实现端点：create、delete、list、addStock、removeStock
    - 使用 Zod schema 验证输入
    - 实现领域异常到 TRPCError 的映射
    - _Requirements: 7.4, 7.5, 7.6_

  - [x] 11.3 注册 Router 到 appRouter
    - 在 `src/server/api/root.ts` 中注册 screeningRouter 和 watchlistRouter
    - _Requirements: 7.1, 7.4_

  - [x] 11.4 编写 tRPC Router 集成测试
    - 使用 Vitest 测试 screening 和 watchlist router 的关键端点
    - 验证 Zod 输入验证、领域异常映射、正常流程
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 12. 测试配置与 fast-check 生成器
  - [x] 12.1 配置 Vitest 测试环境
    - 安装 vitest 开发依赖（如尚未安装）
    - 创建 `vitest.config.ts` 配置文件
    - 在 `package.json` 中添加 test 脚本
    - _Requirements: 全局_

  - [x] 12.2 创建 fast-check 生成器工具库
    - 创建 `src/server/domain/screening/__tests__/generators.ts`
    - 实现核心生成器：arbStockCode、arbIndicatorField、arbNumericValue、arbTextValue、arbListValue、arbRangeValue
    - 实现 arbFilterCondition（过滤不兼容组合）
    - 实现 arbFilterGroup（使用 fc.letrec 递归生成）
    - 实现 arbScoringConfig（权重归一化到 1.0）
    - 实现 arbStock、arbScreeningStrategy、arbWatchList
    - _Requirements: 全局_

- [x] 13. Final Checkpoint - 全部测试通过
  - 确保所有单元测试、属性基测试和集成测试通过，如有问题请向用户确认。

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 属性基测试使用 fast-check 库，每个属性测试至少运行 100 次迭代
- Python 服务使用 pytest 测试，TypeScript 使用 Vitest
- 领域层不依赖任何外部库（Prisma、HTTP 等），通过接口反转实现依赖倒置
- 每个属性基测试标注格式：`Feature: stock-screening-platform, Property {N}: {属性标题}`

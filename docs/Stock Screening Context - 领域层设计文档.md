<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>

# Stock Screening Context - 领域层设计文档（完整版）

**文档版本**: v1.0
**最后更新**: 2026-01-24
**设计状态**: 领域层设计已完成，待进入应用层设计

***

## 目录

1. [领域模型概览](#%E4%B8%80%E9%A2%86%E5%9F%9F%E6%A8%A1%E5%9E%8B%E6%A6%82%E8%A7%88)
2. [聚合根设计](#%E4%BA%8C%E8%81%9A%E5%90%88%E6%A0%B9%E8%AE%BE%E8%AE%A1)
3. [实体设计](#%E4%B8%89%E5%AE%9E%E4%BD%93%E8%AE%BE%E8%AE%A1)
4. [值对象设计](#%E5%9B%9B%E5%80%BC%E5%AF%B9%E8%B1%A1%E8%AE%BE%E8%AE%A1)
5. [枚举设计](#%E4%BA%94%E6%9E%9A%E4%B8%BE%E8%AE%BE%E8%AE%A1)
6. [领域服务设计](#%E5%85%AD%E9%A2%86%E5%9F%9F%E6%9C%8D%E5%8A%A1%E8%AE%BE%E8%AE%A1)
7. [Repository接口设计](#%E4%B8%83repository%E6%8E%A5%E5%8F%A3%E8%AE%BE%E8%AE%A1)
8. [设计决策记录](#%E5%85%AB%E8%AE%BE%E8%AE%A1%E5%86%B3%E7%AD%96%E8%AE%B0%E5%BD%95)



# 股票筛选系统设计文档

## 一、领域模型概览
- 1.1 核心业务场景
- 1.2 聚合限界边界
- 1.3 领域模型关系图

## 二、聚合根设计
### 2.1 ScreeningStrategy（筛选策略）
- 2.1.1 属性
- 2.1.2 业务不变量
- 2.1.3 核心行为

### 2.2 ScreeningSession（筛选执行会话）
- 2.2.1 属性
- 2.2.2 设计说明
- 2.2.3 核心行为

### 2.3 WatchList（自选股列表）
- 2.3.1 属性
- 2.3.2 业务不变量
- 2.3.3 核心行为

## 三、实体设计
### 3.1 FilterGroup（筛选条件组）
- 3.1.1 为什么是实体？
- 3.1.2 属性
- 3.1.3 核心行为
- 3.1.4 示例

### 3.2 Stock（股票实体 - Screening Context视角）
- 3.2.1 设计说明
- 3.2.2 属性
- 3.2.3 核心行为
- 3.2.4 数据缺失处理

## 四、值对象设计
### 4.1 FilterCondition（筛选条件）
- 4.1.1 为什么是值对象？
- 4.1.2 属性
- 4.1.3 核心行为
- 4.1.4 构造时验证

### 4.2 IndicatorValue（指标值 - Tagged Union）
- 4.2.1 设计模式
- 4.2.2 子类设计

### 4.3 ScoringConfig（评分配置）
- 4.3.1 属性
- 4.3.2 业务规则
- 4.3.3 归一化方法
- 4.3.4 示例

### 4.4 ScreeningResult（筛选结果）
- 4.4.1 属性
- 4.4.2 核心行为

### 4.5 ScoredStock（带评分的股票）
- 4.5.1 属性
- 4.5.2 indicator_values包含的指标
- 4.5.3 示例

### 4.6 WatchedStock（自选股中的股票）
- 4.6.1 属性
- 4.6.2 tags设计

### 4.7 标识符值对象
- 4.7.1 StrategyId
- 4.7.2 SessionId
- 4.7.3 WatchListId

## 五、枚举设计
### 5.1 IndicatorField（指标字段）
- 5.1.1 分层设计
- 5.1.2 基础指标（BasicIndicator）
- 5.1.3 时间序列指标（TimeSeriesIndicator）
- 5.1.4 衍生指标（DerivedIndicator）

### 5.2 ComparisonOperator（比较运算符）
### 5.3 LogicalOperator（逻辑运算符）
### 5.4 IndicatorCategory（指标类别）
### 5.5 ValueType（值类型）
### 5.6 NormalizationMethod（归一化方法）

## 六、领域服务设计
### 6.1 IScoringService（评分服务）
- 6.1.1 职责
- 6.1.2 接口方法
- 6.1.3 设计说明

### 6.2 IIndicatorCalculationService（指标计算服务）
- 6.2.1 职责
- 6.2.2 接口方法
- 6.2.3 内部路由逻辑（概念设计）
- 6.2.4 衍生指标计算示例（硬编码）

## 七、Repository接口设计
- 7.1 IScreeningStrategyRepository
- 7.2 IScreeningSessionRepository
- 7.3 IWatchListRepository
- 7.4 需求方接口：IHistoricalDataProvider
- 7.5 共享接口：IMarketDataRepository

## 八、设计决策记录
- 8.1 核心设计决策
- 8.2 暂不实现的功能（第二版考虑）
- 8.3 技术约束与假设
- 8.4 关键约定

## 九、下一步工作
- 9.1 已完成
- 9.2 待讨论




***

## 一、领域模型概览

### 1.1 核心业务场景

Stock Screening Context支持私募投资者的核心工作流：

```
1. 定义筛选策略（自然语言 → 结构化条件）
2. 执行筛选（扫描全市场 → 匹配 → 评分 → 排序）
3. 查看历史（类似AI对话界面的历史记录）
4. 管理自选股（从筛选结果中挑选关注的股票）
```


### 1.2 聚合根边界

```
Stock Screening Context包含3个聚合根：

┌─────────────────────────────────────────────────┐
│  ScreeningStrategy（筛选策略）                   │
│  职责：定义"怎么筛选"                             │
│  生命周期：创建 → 修改 → 保存为模板 → 长期存在    │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  ScreeningSession（筛选执行会话）                 │
│  职责：记录"某次执行的结果"                        │
│  生命周期：执行 → 查看 → 删除（可选）              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  WatchList（自选股列表）                          │
│  职责：用户的股票关注列表                          │
│  生命周期：创建 → 添加股票 → 长期维护              │
│  说明：第一版放在Screening Context，              │
│       后续可迁移到Portfolio Context               │
└─────────────────────────────────────────────────┘
```


### 1.3 领域模型关系图

```
ScreeningStrategy (聚合根)
├─ strategy_id: StrategyId
├─ name: string
├─ tags: List<string>  ← 用于分类
├─ filters: FilterGroup (实体，递归结构)
│   ├─ operator: LogicalOperator (AND/OR/NOT)
│   ├─ conditions: List<FilterCondition> (值对象)
│   └─ sub_groups: List<FilterGroup> (递归)
├─ scoring_config: ScoringConfig (值对象)
├─ is_template: boolean
└─ created_at, updated_at

ScreeningSession (聚合根)
├─ session_id: SessionId
├─ strategy_id: StrategyId (引用)
├─ strategy_name: string (冗余)
├─ executed_at: datetime
├─ top_stocks: List<ScoredStock> (前50只，完整信息)
├─ other_stock_codes: List<StockCode> (其他股票代码)
├─ filters_snapshot: FilterGroup (快照)
└─ scoring_config_snapshot: ScoringConfig (快照)

WatchList (聚合根)
├─ watchlist_id: WatchListId
├─ name: string
├─ description: string?
├─ stocks: List<WatchedStock> (值对象)
│   ├─ stock_code: StockCode
│   ├─ stock_name: string (冗余)
│   ├─ added_at: datetime
│   ├─ note: string? (用户备注)
│   └─ tags: List<string>? (自由文本标签)
└─ created_at, updated_at
```


***

## 二、聚合根设计

### 2.1 ScreeningStrategy（筛选策略）

#### 2.1.1 属性

| 属性名 | 类型 | 说明 | 约束 |
| :-- | :-- | :-- | :-- |
| strategy_id | StrategyId | 策略唯一标识符 | 必填 |
| name | string | 策略名称 | 必填，唯一 |
| description | string? | 策略描述 | 可选 |
| filters | FilterGroup | 筛选条件组 | 必填，至少包含一个条件 |
| scoring_config | ScoringConfig | 评分配置 | 必填 |
| tags | List\<string\> | 标签（用于分类） | 可选，如["成长股", "科技"] |
| is_template | boolean | 是否为模板 | 默认false |
| created_at | datetime | 创建时间 | 自动生成 |
| updated_at | datetime | 更新时间 | 自动更新 |

#### 2.1.2 业务不变量

1. **name不能为空**
2. **filters必须包含至少一个有效条件**（递归检查FilterGroup）
3. **scoring_config的权重之和必须=1.0**

#### 2.1.3 核心行为

```
execute(
  candidate_stocks: List<Stock>,
  scoring_service: IScoringService,
  calc_service: IIndicatorCalculationService
) → ScreeningResult:
  """
  执行筛选策略
  
  流程：
  1. 应用筛选条件（filters.match()）
  2. 对匹配的股票评分（scoring_service.score_stocks()）
  3. 排序（按score降序）
  4. 构建ScreeningResult
  
  Args:
    candidate_stocks: 候选股票列表（通常是全市场）
    scoring_service: 评分领域服务
    calc_service: 指标计算服务（传递给FilterCondition）
  
  Returns:
    ScreeningResult值对象
  """

add_filter(condition: FilterCondition) → void:
  """
  添加筛选条件
  
  逻辑：添加到filters的条件列表
  触发：updated_at更新、不变量验证
  """

remove_filter(condition: FilterCondition) → void:
  """移除筛选条件"""

update_scoring_config(config: ScoringConfig) → void:
  """更新评分配置"""

mark_as_template() → void:
  """标记为模板"""

add_tag(tag: string) → void:
  """添加标签"""

remove_tag(tag: string) → void:
  """移除标签"""

has_tag(tag: string) → bool:
  """检查是否包含某标签"""

clone_with_modifications(
  new_name: string,
  modifications: dict?
) → ScreeningStrategy:
  """
  基于当前策略克隆新策略
  
  用途：用户基于模板创建新策略
  """
```


***

### 2.2 ScreeningSession（筛选执行会话）

#### 2.2.1 属性

| 属性名 | 类型 | 说明 | 约束 |
| :-- | :-- | :-- | :-- |
| session_id | SessionId | 会话唯一标识符 | 必填 |
| strategy_id | StrategyId | 关联的策略ID | 必填 |
| strategy_name | string | 策略名称（冗余） | 必填 |
| executed_at | datetime | 执行时间 | 自动生成 |
| total_scanned | int | 扫描的总股票数 | 必填 |
| execution_time | float | 执行耗时（秒） | 必填 |
| top_stocks | List\<ScoredStock\> | 前50只股票（完整信息） | 必填 |
| other_stock_codes | List\<StockCode\> | 其他匹配股票（只保存代码） | 可选 |
| filters_snapshot | FilterGroup | 筛选条件快照 | 必填 |
| scoring_config_snapshot | ScoringConfig | 评分配置快照 | 必填 |

#### 2.2.2 设计说明

**分层存储策略**：

- `top_stocks`: 前50只股票，包含完整的ScoredStock信息（用于详细展示）
- `other_stock_codes`: 其他匹配股票只保存StockCode（节省存储空间）
- 理由：用户通常只关心Top股票的详细信息

**快照机制**：

- `filters_snapshot`和`scoring_config_snapshot`保存执行时的配置
- 即使原Strategy被修改或删除，Session仍可复现当时的筛选逻辑


#### 2.2.3 核心行为

```
get_all_matched_codes() → List<StockCode>:
  """
  返回所有匹配的股票代码
  
  逻辑：
    top_stocks中的代码 + other_stock_codes
  """

get_stock_detail(stock_code: StockCode) → ScoredStock | None:
  """
  获取某只股票的详细信息
  
  返回：
  - 如果在top_stocks中，返回完整ScoredStock
  - 如果在other_stock_codes中，返回None（需要应用层重新计算）
  """

get_top_n(n: int) → List<ScoredStock>:
  """获取前N只股票"""

count_matched() → int:
  """统计匹配的股票总数"""
```


***

### 2.3 WatchList（自选股列表）

#### 2.3.1 属性

| 属性名 | 类型 | 说明 | 约束 |
| :-- | :-- | :-- | :-- |
| watchlist_id | WatchListId | 列表唯一标识符 | 必填 |
| name | string | 列表名称 | 必填，如"新能源自选" |
| description | string? | 列表描述 | 可选 |
| stocks | List\<WatchedStock\> | 股票列表 | 可为空 |
| created_at | datetime | 创建时间 | 自动生成 |
| updated_at | datetime | 更新时间 | 自动更新 |

#### 2.3.2 业务不变量

1. **name不能为空**
2. **stocks列表中不能有重复的stock_code**

#### 2.3.3 核心行为

```
add_stock(
  stock_code: StockCode,
  stock_name: string,
  note: string? = None,
  tags: List<string>? = None
) → void:
  """
  添加股票到列表
  
  业务规则：
  - 如果股票已存在，抛出异常（DuplicateStockError）
  - 更新updated_at
  
  异常：
  - DuplicateStockError: 股票已存在
  """

remove_stock(stock_code: StockCode) → void:
  """
  移除股票
  
  异常：
  - StockNotFoundError: 股票不存在
  """

update_stock_note(stock_code: StockCode, note: string) → void:
  """更新股票备注"""

update_stock_tags(stock_code: StockCode, tags: List<string>) → void:
  """更新股票标签"""

contains(stock_code: StockCode) → bool:
  """检查是否包含某只股票"""

get_stock(stock_code: StockCode) → WatchedStock | None:
  """获取股票详情"""

get_stocks_by_tag(tag: string) → List<WatchedStock>:
  """在本列表内查询带某标签的股票"""

count_stocks() → int:
  """统计股票数量"""
```


***

## 三、实体设计

### 3.1 FilterGroup（筛选条件组）

#### 3.1.1 为什么是实体？

- ✅ 有唯一标识（group_id）：前端需要标识每个条件组来实现"删除第2组"
- ✅ 有生命周期：随着用户调整条件而演化
- ✅ 有内部状态变化：可以动态添加/删除条件


#### 3.1.2 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| group_id | string | 条件组标识符（UUID） |
| operator | LogicalOperator | 逻辑运算符（AND/OR/NOT） |
| conditions | List\<FilterCondition\> | 简单条件列表 |
| sub_groups | List\<FilterGroup\> | 子条件组（递归） |

#### 3.1.3 核心行为

```
match(stock: Stock, calc_service: IIndicatorCalculationService) → bool:
  """
  判断股票是否匹配条件组
  
  算法：
  - AND: 所有条件和子组都必须满足
  - OR: 至少一个条件或子组满足
  - NOT: 对子组/条件取反（只能有一个子元素）
  
  Args:
    stock: 股票实体
    calc_service: 指标计算服务（传递给FilterCondition）
  
  Returns:
    是否匹配
  """

add_condition(condition: FilterCondition) → void:
  """添加简单条件"""

add_sub_group(group: FilterGroup) → void:
  """添加子条件组"""

remove_condition(condition: FilterCondition) → void:
  """移除条件"""

remove_sub_group(group_id: string) → void:
  """移除子组（通过ID）"""

has_any_condition() → bool:
  """递归检查是否包含任何条件"""

count_total_conditions() → int:
  """递归统计总条件数"""

to_dict() → dict:
  """序列化为字典（用于API传输和持久化）"""

@classmethod
from_dict(data: dict) → FilterGroup:
  """从字典反序列化"""
```


#### 3.1.4 示例

**条件表达式**：`(ROE>15% AND 连续增长3年) OR (制造业 AND ROE>12%)`

**FilterGroup结构**：

```
FilterGroup(operator=OR)
├─ sub_group_1 (operator=AND)
│   ├─ condition: ROE > 15%
│   └─ condition: ROE连续增长年数 >= 3
└─ sub_group_2 (operator=AND)
    ├─ condition: 行业 = 制造业
    └─ condition: ROE > 12%
```


***

### 3.2 Stock（股票实体 - Screening Context视角）

#### 3.2.1 设计说明

- Stock在每个上下文中有不同的定义
- Shared Kernel只共享StockCode值对象
- Screening Context的Stock只包含筛选需要的属性


#### 3.2.2 属性

| 属性名 | 类型 | 说明 | 约束 |
| :-- | :-- | :-- | :-- |
| stock_code | StockCode | 股票代码（Shared Kernel） | 必填 |
| name | string | 股票名称 | 必填 |
| industry | string | 所属行业 | 必填 |
| sector | string | 所属板块 | 可选 |
| roe | float? | 净资产收益率 | 可选 |
| pe | float? | 市盈率 | 可选 |
| pb | float? | 市净率 | 可选 |
| eps | float? | 每股收益 | 可选 |
| revenue | float? | 营业收入（亿元） | 可选 |
| net_profit | float? | 净利润（亿元） | 可选 |
| debt_ratio | float? | 资产负债率 | 可选 |
| market_cap | float? | 总市值（亿元） | 可选 |
| float_market_cap | float? | 流通市值（亿元） | 可选 |
| data_date | date | 数据更新日期 | 必填 |
| is_complete | boolean | 数据是否完整 | 必填 |

#### 3.2.3 核心行为

```
get_value(indicator: IndicatorField) → Any:
  """
  获取基础指标的值
  
  仅支持BasicIndicator（如ROE、PE）
  不支持时间序列和衍生指标（由IIndicatorCalculationService处理）
  
  Returns:
    指标值（可能是None，表示数据缺失）
  """
```


#### 3.2.4 数据缺失处理

- 属性类型都是Optional（如`roe: float?`）
- FilterCondition.evaluate()时，如果actual_value为None，默认返回False（不匹配）
- 用户可在第二版设置"允许缺失数据"的策略

***

## 四、值对象设计

### 4.1 FilterCondition（筛选条件）

#### 4.1.1 为什么是值对象？

- ❌ 不需要唯一标识：两个"ROE>15%"是等价的
- ✅ 不可变：修改条件=删除旧的+创建新的
- ✅ 通过属性判断相等


#### 4.1.2 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| field | IndicatorField | 指标字段（枚举） |
| operator | ComparisonOperator | 比较运算符（枚举） |
| value | IndicatorValue | 指标值（tagged union） |

#### 4.1.3 核心行为

```
evaluate(
  stock: Stock,
  calc_service: IIndicatorCalculationService
) → bool:
  """
  判断股票是否满足条件
  
  流程：
  1. 通过calc_service计算指标的实际值
  2. 处理None（数据缺失时返回False）
  3. 应用运算符比较
  
  Args:
    stock: 股票实体
    calc_service: 指标计算服务
  
  Returns:
    是否满足条件
  """

validate() → ValidationResult:
  """
  验证条件的合理性（单条件内部验证）
  
  检查：
  - 值是否在合理范围（如ROE 0-1）
  - 运算符是否适用（如文本字段不能用GREATER_THAN）
  - field与value类型是否匹配
  
  Returns:
    ValidationResult（包含is_valid和error_messages）
  """

to_dict() → dict:
  """序列化为字典"""

@classmethod
from_dict(data: dict) → FilterCondition:
  """从字典反序列化"""
```


#### 4.1.4 构造时验证

```
FilterCondition.__init__(field, operator, value):
  # 验证1：field与value类型必须匹配
  if field.value_type == ValueType.NUMERIC and not isinstance(value, NumericValue):
      raise TypeError(...)
  
  # 验证2：operator必须适用于value类型
  if operator == IN and not isinstance(value, ListValue):
      raise ValueError(...)
  
  # 验证3：时间序列指标的特殊处理
  if field.category == IndicatorCategory.TIME_SERIES:
      if not isinstance(value, TimeSeriesValue):
          raise TypeError(...)
  
  # 验证4：值的合理性
  if field == ROE and isinstance(value, NumericValue):
      if not (0 <= value.value <= 1):
          raise ValueError("ROE应在0-1之间")
```


***

### 4.2 IndicatorValue（指标值 - Tagged Union）

#### 4.2.1 设计模式

使用**Tagged Union**模式（用类模拟）：

- 抽象基类 `IndicatorValue`
- 具体实现类：`NumericValue`, `TextValue`, `ListValue`, `RangeValue`, `TimeSeriesValue`


#### 4.2.2 子类设计

**NumericValue（数值类型）**

```
属性：
  - value: float
  - unit: string?（可选，如"%"、"亿元"）

方法：
  - to_comparable() → float
  - __init__验证：value不能是NaN或Infinity

用途：
  - ROE > 0.15
  - 市值 > 100（亿元）
```

**TextValue（文本类型）**

```
属性：
  - value: string

方法：
  - to_comparable() → string

用途：
  - 行业 = "制造业"
  - 板块 = "科创板"
```

**ListValue（列表类型）**

```
属性：
  - values: List<string>

方法：
  - to_comparable() → List<string>

用途：
  - 行业 IN ["制造业", "科技", "医药"]
```

**RangeValue（区间类型）**

```
属性：
  - min: float
  - max: float

方法：
  - to_comparable() → Tuple<float, float>
  - __init__验证：min <= max

用途：
  - 市值 BETWEEN [100, 500]（亿元）
```

**TimeSeriesValue（时间序列参数）**

```
属性：
  - years: int（时间跨度）
  - threshold: float?（可选阈值）

方法：
  - to_comparable() → dict

用途：
  - ROE连续增长年数 >= TimeSeriesValue(years=3, threshold=0)
  - 3年平均ROE > TimeSeriesValue(years=3)
```


***

### 4.3 ScoringConfig（评分配置）

#### 4.3.1 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| weights | Map\<IndicatorField, float\> | 各指标的权重 |
| normalization_method | NormalizationMethod | 归一化方法（枚举） |

#### 4.3.2 业务规则

- **weights的和必须=1.0**
- **weights的key必须是可计算的指标**（不能是行业等文本字段）


#### 4.3.3 归一化方法

```
NormalizationMethod（枚举）

MIN_MAX = "min_max"
  公式：(value - min) / (max - min)
  结果：0-1之间
  
  第一版实现：只用MIN_MAX
```


#### 4.3.4 示例

```
ScoringConfig(
  weights = {
    ROE: 0.3,
    PE: 0.2,
    REVENUE_CAGR_3Y: 0.5
  },
  normalization_method = NormalizationMethod.MIN_MAX
)

评分逻辑（由IScoringService实现）：
  1. 对每个指标在所有股票中归一化（MIN_MAX）
  2. score = Σ(归一化值 × 权重)
  3. score范围：0-1
```


***

### 4.4 ScreeningResult（筛选结果）

#### 4.4.1 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| matched_stocks | List\<ScoredStock\> | 匹配的股票列表（已评分、已排序） |
| total_scanned | int | 扫描的总股票数 |
| execution_time | float | 执行耗时（秒） |
| filters_applied | FilterGroup | 应用的筛选条件（快照） |
| scoring_config | ScoringConfig | 评分配置（快照） |
| timestamp | datetime | 执行时间戳 |

#### 4.4.2 核心行为

```
get_top_n(n: int) → List<ScoredStock>:
  """获取前N只股票"""

filter_by_score(min_score: float) → List<ScoredStock>:
  """按最低分数过滤"""

count_matched() → int:
  """统计匹配的股票数量"""
```


***

### 4.5 ScoredStock（带评分的股票）

#### 4.5.1 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| stock_code | StockCode | 股票代码 |
| stock_name | string | 股票名称 |
| score | float | 总分（0-1） |
| score_breakdown | Map\<IndicatorField, float\> | 各指标得分 |
| indicator_values | Map\<IndicatorField, Any\> | 关键指标的值 |
| matched_conditions | List\<FilterCondition\> | 匹配的条件（调试用） |

#### 4.5.2 indicator_values包含的指标

- **筛选条件用到的指标**（用户需要知道"为什么这只股票被筛出"）
- **评分用到的指标**（用户需要知道"评分的依据"）
- 两者的并集


#### 4.5.3 示例

```
ScoredStock(
  stock_code = StockCode("600519"),
  stock_name = "贵州茅台",
  score = 0.85,
  score_breakdown = {
    ROE: 0.9,  # ROE在所有股票中排名90%
    PE: 0.7,
    REVENUE_CAGR_3Y: 0.95
  },
  indicator_values = {
    ROE: 0.28,
    PE: 35.5,
    REVENUE_CAGR_3Y: 0.25,
    行业: "白酒"
  },
  matched_conditions = [
    FilterCondition(ROE > 0.15),
    FilterCondition(REVENUE_CAGR_3Y >= 0.2)
  ]
)
```


***

### 4.6 WatchedStock（自选股中的股票）

#### 4.6.1 属性

| 属性名 | 类型 | 说明 |
| :-- | :-- | :-- |
| stock_code | StockCode | 股票代码 |
| stock_name | string | 股票名称（冗余） |
| added_at | datetime | 添加时间 |
| note | string? | 用户备注 |
| tags | List\<string\>? | 自由文本标签 |

#### 4.6.2 tags设计

- **自由文本列表**（不是预定义枚举）
- 示例：`["长期持有", "高ROE", "看好光伏"]`
- 可能重复/混乱，但灵活性更高
- 后续可加"标签推荐"功能

***

### 4.7 标识符值对象

#### 4.7.1 StrategyId

```
属性：
  - value: string（UUID格式）

验证：
  - 构造时验证UUID格式

工厂方法：
  - StrategyId.generate() → StrategyId  # 生成新ID
  - StrategyId.from_string(value: string) → StrategyId
```


#### 4.7.2 SessionId

```
同StrategyId设计
```


#### 4.7.3 WatchListId

```
同StrategyId设计
```


***

## 五、枚举设计

### 5.1 IndicatorField（指标字段）

#### 5.1.1 分层设计

```
IndicatorField（统一枚举，按类别组织）

每个枚举值关联元数据：
  - name: string（显示名称）
  - category: IndicatorCategory（BASIC/TIME_SERIES/DERIVED）
  - value_type: ValueType（NUMERIC/TEXT）
  - description: string
```


#### 5.1.2 基础指标（BasicIndicator）

直接来自数据源，无需计算


| 枚举值 | 中文名 | 类型 | 说明 |
| :-- | :-- | :-- | :-- |
| ROE | 净资产收益率 | NUMERIC | 0-1之间 |
| PE | 市盈率 | NUMERIC | >0 |
| PB | 市净率 | NUMERIC | >0 |
| EPS | 每股收益 | NUMERIC | 可为负 |
| REVENUE | 营业收入 | NUMERIC | 单位：亿元 |
| NET_PROFIT | 净利润 | NUMERIC | 单位：亿元，可为负 |
| DEBT_RATIO | 资产负债率 | NUMERIC | 0-1之间 |
| MARKET_CAP | 总市值 | NUMERIC | 单位：亿元 |
| FLOAT_MARKET_CAP | 流通市值 | NUMERIC | 单位：亿元 |
| INDUSTRY | 所属行业 | TEXT | 如"制造业" |
| SECTOR | 所属板块 | TEXT | 如"科创板" |

#### 5.1.3 时间序列指标（TimeSeriesIndicator）

需要多期历史数据计算


| 枚举值 | 中文名 | 类型 | 说明 |
| :-- | :-- | :-- | :-- |
| ROE_CONTINUOUS_GROWTH_YEARS | ROE连续增长年数 | NUMERIC | 统计连续增长的年数 |
| REVENUE_CAGR_3Y | 营收3年复合增长率 | NUMERIC | CAGR公式 |
| REVENUE_CAGR_5Y | 营收5年复合增长率 | NUMERIC | CAGR公式 |
| NET_PROFIT_YOY | 净利润同比增速 | NUMERIC | 同比增长率 |
| ROE_AVG_3Y | 3年平均ROE | NUMERIC | 算术平均 |
| ROE_AVG_5Y | 5年平均ROE | NUMERIC | 算术平均 |
| REVENUE_GROWTH_STABILITY | 营收增长稳定性 | NUMERIC | 标准差（越小越稳定） |

#### 5.1.4 衍生指标（DerivedIndicator）

由基础指标计算得出（预定义，不支持用户自定义）


| 枚举值 | 中文名 | 类型 | 计算公式 |
| :-- | :-- | :-- | :-- |
| PE_PB_RATIO | PE/PB | NUMERIC | PE ÷ PB |
| PEG | PEG | NUMERIC | PE ÷ 净利润增速 |
| ROE_MINUS_DEBT | ROE-负债率 | NUMERIC | ROE - DEBT_RATIO |
| MARKET_CAP_TO_REVENUE | 市销率 | NUMERIC | 市值 ÷ 营收 |
| EV_TO_EBITDA | 企业价值倍数 | NUMERIC | 复杂公式（第二版实现） |


***

### 5.2 ComparisonOperator（比较运算符）

| 枚举值 | 符号 | 适用类型 | 说明 |
| :-- | :-- | :-- | :-- |
| GREATER_THAN | > | NUMERIC | 大于 |
| LESS_THAN | < | NUMERIC | 小于 |
| EQUALS | = | NUMERIC/TEXT | 等于 |
| GREATER_OR_EQUAL | >= | NUMERIC | 大于等于 |
| LESS_OR_EQUAL | <= | NUMERIC | 小于等于 |
| NOT_EQUALS | != | NUMERIC/TEXT | 不等于 |
| IN | in | TEXT | 在列表中 |
| NOT_IN | not_in | TEXT | 不在列表中 |
| BETWEEN | between | NUMERIC | 在区间内 |
| NOT_BETWEEN | not_between | NUMERIC | 不在区间内 |

**apply方法**（放在枚举内部）：

```
ComparisonOperator.apply(
  actual: Any,
  expected: IndicatorValue
) → bool:
  """
  应用运算符进行比较
  
  逻辑示例：
  - GREATER_THAN: return actual > expected.value
  - IN: return actual in expected.values
  - BETWEEN: return expected.min <= actual <= expected.max
  
  类型检查：
  - GREATER_THAN要求expected是NumericValue
  - IN要求expected是ListValue
  - BETWEEN要求expected是RangeValue
  """
```


***

### 5.3 LogicalOperator（逻辑运算符）

| 枚举值 | 说明 |
| :-- | :-- |
| AND | 所有条件都必须满足 |
| OR | 至少一个条件满足 |
| NOT | 对子条件取反（只能有一个子元素） |


***

### 5.4 IndicatorCategory（指标类别）

| 枚举值 | 说明 |
| :-- | :-- |
| BASIC | 基础指标（直接来自数据源） |
| TIME_SERIES | 时间序列指标（需要历史数据） |
| DERIVED | 衍生指标（由基础指标计算） |

用途：IIndicatorCalculationService根据category路由到不同的计算逻辑

***

### 5.5 ValueType（值类型）

| 枚举值 | 说明 |
| :-- | :-- |
| NUMERIC | 数值类型 |
| TEXT | 文本类型 |

用途：验证FilterCondition的field与value类型匹配

***

### 5.6 NormalizationMethod（归一化方法）

| 枚举值 | 公式 | 说明 |
| :-- | :-- | :-- |
| MIN_MAX | (value - min) / (max - min) | 结果：0-1之间（第一版只实现这个） |


***

## 六、领域服务设计

### 6.1 IScoringService（评分服务）

#### 6.1.1 职责

- 根据ScoringConfig对股票进行评分
- 归一化指标值
- 计算加权总分


#### 6.1.2 接口方法

```
IScoringService（领域服务接口）

score_stocks(
  stocks: List<Stock>,
  config: ScoringConfig,
  calc_service: IIndicatorCalculationService
) → List<ScoredStock>:
  """
  对股票列表评分
  
  流程：
  1. 对每只股票计算config中指定的指标值
  2. 对每个指标进行归一化（MIN_MAX）
  3. 计算加权总分：score = Σ(归一化值 × 权重)
  4. 构建ScoredStock对象
  
  Args:
    stocks: 待评分的股票列表
    config: 评分配置（包含权重和归一化方法）
    calc_service: 指标计算服务
  
  Returns:
    带评分的股票列表（未排序）
  
  异常：
    - ScoringError: 评分失败（如所有股票的某指标都为None）
  """
```


#### 6.1.3 设计说明

- **无状态**：每次调用都是独立的
- **不负责排序**：排序由ScreeningStrategy.execute()完成
- **处理数据缺失**：如果某只股票的指标值为None，该指标得分为0

***

### 6.2 IIndicatorCalculationService（指标计算服务）

#### 6.2.1 职责

1. 计算所有类型指标的值（基础/时间序列/衍生）
2. 验证衍生指标的嵌套限制
3. 处理计算异常（如除零、缺失数据）

#### 6.2.2 接口方法

```
IIndicatorCalculationService（领域服务接口）

calculate_indicator(
  indicator: IndicatorField,
  stock: Stock
) → float | string | None:
  """
  计算指标值
  
  流程：
  1. 根据indicator.category路由：
     - BASIC: 直接从stock.get_value()获取
     - TIME_SERIES: 调用_calculate_time_series()
     - DERIVED: 调用_calculate_derived()
  2. 处理异常（如除零）
  3. 返回结果（可能为None表示数据缺失）
  
  Args:
    indicator: 要计算的指标
    stock: 股票实体
  
  Returns:
    指标值（可能是float、string，或None）
  
  异常：
    - IndicatorCalculationError: 计算失败
  """

validate_derived_indicator(
  indicator: IndicatorField
) → ValidationResult:
  """
  验证衍生指标的嵌套层数
  
  规则：
  - 衍生指标只能由基础指标计算（不能嵌套衍生指标）
  - 如PE_PB_RATIO（PE/PB）合法
  - 如(PE/PB) / (ROE-负债率)非法（二层嵌套）
  
  仅对DerivedIndicator有效
  
  Returns:
    ValidationResult
  """

calculate_batch(
  indicators: List<IndicatorField>,
  stock: Stock
) → Map<IndicatorField, Any>:
  """
  批量计算多个指标（性能优化）
  
  用途：
  - 评分时需要计算多个指标
  - 避免重复调用历史数据提供者
  """
```


#### 6.2.3 内部路由逻辑（概念设计）

```
_calculate_time_series(
  indicator: IndicatorField,
  stock: Stock
) → float:
  """
  计算时间序列指标
  
  示例：ROE_CONTINUOUS_GROWTH_YEARS
  
  流程：
  1. 从IHistoricalDataProvider获取历史数据
  2. 应用时间序列算法（如计算连续增长年数）
  3. 返回结果
  
  依赖：
  - IHistoricalDataProvider
  """

_calculate_derived(
  indicator: IndicatorField,
  stock: Stock
) → float:
  """
  计算衍生指标
  
  示例：PE_PB_RATIO
  
  流程：
  1. 验证嵌套层数
  2. 获取基础指标值（如PE、PB）
  3. 应用公式计算（硬编码）
  4. 处理除零等异常
  
  实现策略：
  - 第一版硬编码预定义的衍生指标
  - 不支持用户自定义
  """
```


#### 6.2.4 衍生指标计算示例（硬编码）

```
实现伪代码：

def _calculate_derived(indicator, stock):
    if indicator == PE_PB_RATIO:
        pe = stock.pe
        pb = stock.pb
        if pe is None or pb is None or pb == 0:
            return None
        return pe / pb
    
    elif indicator == PEG:
        pe = stock.pe
        growth = self.calculate_indicator(NET_PROFIT_YOY, stock)
        if pe is None or growth is None or growth == 0:
            return None
        return pe / growth
    
    elif indicator == ROE_MINUS_DEBT:
        roe = stock.roe
        debt = stock.debt_ratio
        if roe is None or debt is None:
            return None
        return roe - debt
    
    else:
        raise ValueError(f"未知的衍生指标: {indicator}")
```


***

## 七、Repository接口设计

### 7.1 IScreeningStrategyRepository

```
IScreeningStrategyRepository（领域层接口）

# ==================== 基本操作 ====================

save(strategy: ScreeningStrategy) → void:
  """
  保存或更新策略
  
  逻辑：
  - 如果strategy_id不存在 → INSERT
  - 如果strategy_id已存在 → UPDATE
  - 级联保存内部的FilterGroup
  """

find_by_id(strategy_id: StrategyId) → ScreeningStrategy | None:
  """
  按ID查询策略
  
  返回：
  - 完整的聚合根（包含嵌套的FilterGroup）
  - 如果不存在返回None
  """

delete(strategy_id: StrategyId) → void:
  """
  删除策略
  
  业务规则：
  - 允许删除（即使被Session引用）
  - Session只保留strategy_id引用，不影响Session的存在
  """

exists(strategy_id: StrategyId) → bool:
  """检查策略是否存在"""


# ==================== 查询方法 ====================

find_all(limit: int = 100, offset: int = 0) → List[ScreeningStrategy]:
  """
  查询所有策略（分页）
  
  返回：完整聚合根（包含FilterGroup）
  排序：按updated_at降序
  """

count_all() → int:
  """统计策略总数"""

find_templates() → List[ScreeningStrategy]:
  """
  查询所有模板策略（is_template=true）
  
  排序：按created_at降序
  """

find_by_name(name: str) → ScreeningStrategy | None:
  """
  按精确名称查询
  
  用途：检查名称唯一性
  """

find_by_name_like(keyword: str, limit: int = 20) → List[ScreeningStrategy]:
  """
  按名称模糊匹配
  
  匹配逻辑：name LIKE '%keyword%'（不区分大小写）
  """

find_recently_updated(limit: int = 10) → List[ScreeningStrategy]:
  """
  查询最近更新的策略
  
  排序：按updated_at降序
  """

find_recently_created(limit: int = 10) → List[ScreeningStrategy]:
  """
  查询最近创建的策略
  
  排序：按created_at降序
  """


# ==================== 标签查询 ====================

find_by_tags(
  tags: List<string>,
  match_all: bool = False
) → List[ScreeningStrategy]:
  """
  按标签查询策略
  
  Args:
    tags: 标签列表，如["成长股", "科技"]
    match_all:
      - True: 策略必须包含所有标签（AND逻辑）
      - False: 策略包含任一标签即可（OR逻辑）
  
  示例：
    find_by_tags(["成长股", "科技"], match_all=False)
    → 返回带"成长股"或"科技"标签的策略
  """
```


***

### 7.2 IScreeningSessionRepository

```
IScreeningSessionRepository（领域层接口）

# ==================== 基本操作 ====================

save(session: ScreeningSession) → void:
  """
  保存执行会话
  
  注意：
  - top_stocks和other_stock_codes的分层存储
  - 高效的序列化策略（JSON压缩）
  """

find_by_id(session_id: SessionId) → ScreeningSession | None:
  """
  按ID查询会话
  
  用途：用户点击历史记录，查看详情
  """

delete(session_id: SessionId) → void:
  """删除会话"""


# ==================== 查询方法 ====================

find_by_strategy(
  strategy_id: StrategyId,
  limit: int = 20
) → List[ScreeningSession]:
  """
  查询某个策略的所有执行历史
  
  排序：按executed_at降序
  用途：用户查看"成长股筛选v3"的历史执行记录
  """

find_recent_sessions(limit: int = 20) → List[ScreeningSession]:
  """
  查询最近的执行会话（跨所有策略）
  
  排序：按executed_at降序
  用途：用户打开系统，看到"最近的筛选"（类似AI对话历史）
  """

find_sessions_by_date_range(
  start_date: date,
  end_date: date
) → List[ScreeningSession]:
  """
  按日期范围查询
  
  用途：用户查看"本周的所有筛选"
  """

count_by_strategy(strategy_id: StrategyId) → int:
  """
  统计某个策略的执行次数
  
  用途：展示"这个策略被执行了N次"
  """

delete_old_sessions(before: datetime) → int:
  """
  删除指定日期之前的会话
  
  Args:
    before: 截止日期（如30天前）
  
  Returns:
    删除的会话数量
  
  用途：定期清理历史数据（Celery定时任务）
  """
```


***

### 7.3 IWatchListRepository

```
IWatchListRepository（领域层接口）

# ==================== 基本操作 ====================

save(watchlist: WatchList) → void:
  """
  保存或更新自选股列表
  
  聚合根边界：
  - 保存WatchList及其内部的所有WatchedStock
  - 级联更新
  """

find_by_id(watchlist_id: WatchListId) → WatchList | None:
  """按ID查询自选股列表"""

delete(watchlist_id: WatchListId) → void:
  """删除自选股列表"""


# ==================== 查询方法 ====================

find_all() → List[WatchList]:
  """
  查询所有自选股列表
  
  排序：按created_at降序
  用途：用户查看所有分组
  """

find_by_name(name: str) → WatchList | None:
  """
  按名称精确查询
  
  用途：检查名称唯一性
  """

count_all() → int:
  """统计自选股列表数量"""

find_lists_containing_stock(
  stock_code: StockCode
) → List[WatchList]:
  """
  查询包含某只股票的所有列表
  
  用途：用户查看"宁德时代在哪些自选股组中？"
  
  实现注意：
  - 需要数据库支持JSON查询（PostgreSQL的JSONB）
  - 或在基础设施层建立关联表：
    watchlist_stock_index:
      - watchlist_id
      - stock_code
  """
```


***

### 7.4 需求方接口：IHistoricalDataProvider

```
IHistoricalDataProvider（领域层定义，基础设施层实现）

职责：
  - 提供股票的历史指标数据
  - 用于时间序列指标的计算


get_indicator_history(
  stock_code: StockCode,
  indicator: IndicatorField,
  years: int,
  end_date: date? = None
) → List[IndicatorDataPoint]:
  """
  获取指定股票的历史指标数据
  
  Args:
    stock_code: 股票代码
    indicator: 基础指标（只能是BasicIndicator，如ROE、营收）
    years: 获取最近N年数据
    end_date: 截止日期（默认为今天，用于回测）
  
  Returns:
    按时间倒序的数据点列表
    
    示例：
    [
      IndicatorDataPoint(date=2023-12-31, value=0.25),
      IndicatorDataPoint(date=2022-12-31, value=0.22),
      IndicatorDataPoint(date=2021-12-31, value=0.18)
    ]
  
  异常：
    - DataNotAvailableError: 数据不可用
  """


IndicatorDataPoint（值对象）:
  """
  历史数据点
  
  属性：
    - date: date  # 报告期
    - value: float  # 指标值
    - is_estimated: bool  # 是否为预估值（某些数据源提供）
  """
```


***

### 7.5 共享接口：IMarketDataRepository

```
IMarketDataRepository[TStock]（Shared Kernel定义，泛型接口）

职责：
  - 提供市场股票数据查询
  - 每个上下文实现自己的Adapter（返回自己的Stock类型）


# ==================== 股票查询 ====================

get_all_stock_codes() → List[StockCode]:
  """
  获取全市场股票代码
  
  用途：
  - 筛选时的候选池（只需要代码，后续按需查详情）
  - 减少内存占用（5000个代码 vs 5000个完整Stock对象）
  
  性能：
  - 必须缓存（Redis）
  - 每日盘后更新一次
  
  返回示例：
  [
    StockCode("600519"),
    StockCode("000001"),
    ...
  ]
  """

get_stock(stock_code: StockCode) → TStock | None:
  """
  按代码查询单只股票的完整信息
  
  用途：
  - 执行筛选时，查询股票详细数据
  - 查看股票详情
  
  返回：
  - Screening Context的Adapter返回ScreeningStock
  - Intelligence Context的Adapter返回IntelligenceStock
  """

get_stocks_by_codes(
  stock_codes: List[StockCode]
) → List[TStock]:
  """
  批量查询股票（性能优化）
  
  用途：
  - 加载WatchList的股票详情
  - 执行筛选时，一次性查询所有候选股票
  
  性能考虑：
  - 建议批次大小<1000
  - 可以分批调用
  """

query_stocks_by_industry(industry: string) → List[TStock]:
  """
  按行业查询股票
  
  用途：
  - 用户设置预过滤："只看科技股"
  - 减少筛选的候选池（性能优化）
  
  注意：
  - 这不是FilterCondition的执行
  - 只是数据层的预筛选
  """

query_stocks_by_market(market: string) → List[TStock]:
  """
  按市场查询（沪市/深市/科创板等）
  
  用途：同上
  """


# ==================== 数据元信息 ====================

get_last_update_time() → datetime:
  """
  获取数据最后更新时间
  
  用途：前端显示"数据更新于2023-01-01 20:00"
  """

get_available_industries() → List[string]:
  """
  获取所有行业列表
  
  用途：
  - 前端下拉框展示行业选项
  - 用户构建"行业=制造业"条件时选择
  
  返回示例：
  ["制造业", "科技", "医药", "金融", ...]
  """
```

**筛选执行流程**（使用IMarketDataRepository）：

```
1. market_data_repo.get_all_stock_codes() → 5000个代码

2. 用户可能设置预过滤（可选）：
   "只看科技股"
   → market_data_repo.query_stocks_by_industry("科技") → 500只股票

3. 批量查询详细数据：
   market_data_repo.get_stocks_by_codes(过滤后的代码) → List<Stock>

4. 执行FilterCondition.evaluate()
   → 匹配的股票

5. 评分、排序
   → ScreeningResult
```


***

## 八、设计决策记录

### 8.1 核心设计决策

| 决策点 | 最终决策 | 理由 |
| :-- | :-- | :-- |
| **聚合根数量** | 3个（Strategy, Session, WatchList） | 清晰的职责分离，独立生命周期 |
| **FilterGroup类型** | 实体（有标识符） | 前端需要标识每个条件组来实现增量修改 |
| **筛选历史存储** | 独立聚合根ScreeningSession | Strategy可能反复执行，Session记录每次结果 |
| **Session数据存储** | 分层存储（Top50完整+其他只保存代码） | 平衡数据完整性和存储效率 |
| **WatchList位置** | 暂放Screening Context | 第一版简化，后续可迁移到Portfolio Context |
| **WatchedStock的tags** | 自由文本列表 | 灵活性优先，第一版不做标签规范 |
| **IndicatorField设计** | 统一枚举（带分类元数据） | 简化设计，计算逻辑封装在服务中 |
| **时间序列指标参数** | TimeSeriesValue值对象 | 语义清晰，避免歧义 |
| **衍生指标嵌套** | 限制一层（硬编码验证） | 防止复杂度爆炸，第一版预定义衍生指标 |
| **Stock包含历史数据** | 否，只包含当前数据 | 按需获取历史数据（通过IHistoricalDataProvider） |
| **IndicatorValue类型** | Tagged Union（类模拟） | 类型安全，防止类型错误 |
| **evaluate()位置** | FilterCondition内部 | 职责清晰，注入calc_service合理 |
| **ScoringConfig评分方式** | 简单加权+MIN_MAX归一化 | 第一版简化，够用 |
| **ScoredStock保存的指标** | 筛选条件+评分指标的并集 | 用户需要知道"为什么筛出"和"如何评分" |
| **Repository查询返回** | 完整聚合根 | 符合DDD原则，性能问题后续优化 |
| **Strategy标签功能** | 支持（tags: List\<string\>） | 用户需要分类管理策略 |
| **IMarketDataRepository.get_all_** | 只返回代码（get_all_stock_codes） | 减少内存占用，按需查询详情 |


***

### 8.2 暂不实现的功能（第二版考虑）

| 功能 | 原因 |
| :-- | :-- |
| 按条件查询策略（如"查询包含ROE>15%的策略"） | 复杂查询，不属于Repository职责，后续用CQRS |
| 用户自定义衍生指标 | 需要解析引擎，复杂度高，第一版预定义即可 |
| estimate_selectivity()（结果数量预估） | 依赖市场统计，第一版不需要 |
| StrategyValidator（跨条件验证） | 矛盾条件筛不到结果也能接受，第一版允许 |
| 查询包含某只股票的Session | 反向查询，需要额外索引，第一版不做 |
| 按标签查询股票（跨WatchList） | 跨聚合根查询，应用层可实现 |
| WatchedStock记录来源Session | 耦合两个聚合根，来源信息可记录在note中 |
| CalculationContext（计算上下文） | 默认用当前日期，回测功能第二版再加 |
| Z_SCORE/PERCENTILE归一化 | 第一版只用MIN_MAX |
| 条件推荐服务 | 锦上添花功能，非核心 |


***

### 8.3 技术约束与假设

| 约束/假设 | 说明 |
| :-- | :-- |
| **数据库** | PostgreSQL（支持JSONB存储FilterGroup） |
| **缓存** | Redis（缓存stock_codes、历史数据） |
| **A股数量** | 约5000只（全市场） |
| **筛选性能目标** | <3秒（5000只股票） |
| **Session保留期限** | 默认30天（定期清理） |
| **衍生指标数量** | 第一版预定义<10个 |
| **时间序列最大年数** | 5年（历史数据限制） |
| **WatchList数量上限** | 无限制（用户可创建任意多个） |
| **单个WatchList股票数** | 建议<100只（前端展示限制） |


***

### 8.4 关键约定

**命名规范**：

- 聚合根：名词（如ScreeningStrategy）
- 值对象：名词（如FilterCondition）
- 领域服务接口：I前缀（如IScoringService）
- Repository接口：I前缀+Repository后缀（如IScreeningStrategyRepository）
- 枚举：复数或描述性名词（如IndicatorField, ComparisonOperator）

**异常命名**：

- 领域异常：描述性名词+Error后缀（如DuplicateStockError）
- 基础设施异常：RepositoryError, DataNotAvailableError等

**方法命名**：

- 查询方法：find_*, get_*, count_*
- 修改方法：add_*, remove_*, update_*, mark_*
- 判断方法：is_*, has_*, contains_*

***

## 九、下一步工作

### 9.1 已完成

- ✅ 聚合根设计（Strategy, Session, WatchList）
- ✅ 实体设计（FilterGroup, Stock）
- ✅ 值对象设计（FilterCondition, IndicatorValue系列, ScoringConfig等）
- ✅ 枚举设计（IndicatorField, ComparisonOperator等）
- ✅ 领域服务设计（IScoringService, IIndicatorCalculationService）
- ✅ Repository接口设计（3个聚合根+2个需求方接口）


### 9.2 待讨论

**选项A：详细设计应用层**

- ScreeningStrategyService, ScreeningExecutionService等
- DTO设计（Request/Response）
- 事务边界设计

**选项B：完善聚合根行为**

- ScreeningStrategy.execute()的详细逻辑
- FilterGroup.match()的完整实现

**选项C：接口层设计（API）**

- RESTful端点设计
- 请求/响应格式

**选项D：端到端用例设计（推荐）**

- 用例："创建并执行筛选策略"
- 串联所有层级，快速验证架构

***

**文档状态**: ✅ 领域层设计完成
**下次讨论**: 根据需求选择A/B/C/D


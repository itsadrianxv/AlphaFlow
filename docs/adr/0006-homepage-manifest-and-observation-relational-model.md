# 首页数据清单与数据观测关系模型

## 状态

已采用。

## 决策

首页数据清单、来源断言、数据观测和数据观测修订使用 PostgreSQL 关系表作为唯一权威源。随机主键只承担外键关系；所有跨重试、跨来源和跨重放的幂等语义使用规范化逻辑键或内容哈希。清单结构和事实历史追加式保存，只有清单门控投影和获取尝试的运行字段允许更新。

### 关系边界

```text
HomepageDataManifest
  ├─ HomepageDataManifestItem
  │    ├─ HomepageDataManifestItemAttempt
  │    └─ HomepageDataManifestItemSettlement
  │          └─ HomepageDataManifestItemSettlementRevision
  └─ (PERSONALIZED 通过 baseManifestId 固定一个 BASELINE)

DataObservation
  └─ DataObservationRevision
       ├─ DataObservationRevisionSource ─ SourceAssertion
       └─ DataObservationRevisionInput ── DataObservationRevision
```

个性化清单的有效项是父基线项与本清单追加项的并集。父基线项不复制，追加项如果与父基线的有效 `itemKey` 冲突则拒绝创建。父基线随后产生的新清单不会改变已经创建的个性化清单。

### 表契约

| 表 | 关键字段与唯一键 | 关系和不可变规则 |
| --- | --- | --- |
| `HomepageDataManifest` | `manifestKey` 唯一；`scope`、`definitionVersion`、`targetContextKey`、`requestNonce`、`gateStatus` | `BASELINE` 必须无 `userId/baseManifestId`；`PERSONALIZED` 必须有用户和父基线，并直接冻结创建时的偏好内容。MVP 不保存偏好指纹。父基线必须在创建事务中已达到必需项门控，允许 `READY_WITH_LIMITATION`。定义字段不可更新，`gateStatus` 只是可重算投影。 |
| `HomepageDataManifestItem` | `(manifestId, itemKey)` 唯一；`datasetKey`、`factScopeKey`、`factScopeJson`、`requirementVersion`、`required`、`emptyPolicy`、`targetDataCutoff` | 记录不可变的请求范围和门控要求，不保存重试状态。`itemKey` 由数据集、事实范围和要求版本规范化生成。 |
| `HomepageDataManifestItemAttempt` | `(manifestItemId, attemptNo)` 唯一；`idempotencyKey` 全局唯一 | 保存 Provider contract/规范化版本、请求哈希、结果信封、错误分类、租约、心跳和 fencing token。重复幂等键复用尝试；真正重试递增 `attemptNo`。只有运行字段可更新。 |
| `HomepageDataManifestItemSettlement` | `manifestItemId` 唯一；`settledAttemptId` 唯一 | 一项至多一条不可变结算，固定结果状态、覆盖范围、质量、目标/实际数据截止点、错误信息和结算时间。`selectedRevisionId` 的单事实快捷引用可以为空；多观测结果使用下方修订集合表。 |
| `HomepageDataManifestItemSettlementRevision` | `(settlementId, observationRevisionId)` 和 `(settlementId, ordinal)` 均唯一 | 固定本次清单使用的全部观测修订；失败或合法空结果没有关联行。来源从修订的冻结来源关联读取，不在结算表重复保存来源外键。 |
| `DataObservation` | `identityKey` 唯一；主体、指标、规范化维度 JSON、期间字段；`currentRevisionId` | `identityKey` 由版本化规范化规则生成，不含来源、抓取时间或取值。主体和身份字段不可更新；`currentRevisionId` 是可重算的读取投影。 |
| `DataObservationRevision` | `(observationId, revisionNo)` 唯一；`revisionDedupKey` 唯一 | 保存类型化规范化值、单位、缺失语义、质量状态、值哈希、规范化规则版本、`supersedesRevisionId`、更正引用和 `normalizedAt`。每个观测在锁内递增序号并维护替代链。普通重复值按观测、值哈希和规则版本幂等；显式更正引用可创建新的链节点。 |
| `SourceAssertion` | `assertionKey` 唯一 | `assertionKey` 由来源、数据集、来源记录身份和原始内容哈希生成。保留来源原始记录、内容哈希、请求参数哈希、Provider 版本及来源时间；不同来源内容相同也不合并。 |
| `DataObservationRevisionSource` | `(revisionId, sourceAssertionId)` 唯一；每个修订只有一个 `SELECTED` | 关联角色为 `SELECTED` 或 `CORROBORATING`，同时冻结权威策略版本、回退原因和选择理由。使用 PostgreSQL 部分唯一索引保证每个修订最多一个选定来源。 |
| `DataObservationRevisionInput` | `(revisionId, inputRevisionId)`、`(revisionId, ordinal)` 均唯一 | 只记录派生修订的直接输入、顺序和角色；禁止自指和环路，算法版本及参数固定在修订或关联记录中。 |

`DataObservationRevision` 与 `SourceAssertion` 的关联必须引用同一稳定观测；该跨表一致性在持久化 repository 的结算事务中校验。`DataObservationRevisionInput` 的环路校验同样在事务内完成，数据库约束负责自指和重复边界。

### 状态与空结果

Provider 信封的结果状态为 `success/degraded/empty/error`，数据质量状态独立为 `normal/degraded/isolated`。清单项结算保存对应的领域结果 `READY/DEGRADED/EMPTY/FAILED`：

- `success` 只有在存在修订、质量正常且实际数据截止点达到目标时才结算为 `READY`；否则按覆盖或截止点限制结算为 `DEGRADED`。
- `degraded` 必须保留可用修订和覆盖/限制说明。
- 合法 `empty` 是不可重试的终态，必须保存请求范围、覆盖范围、实际数据截止点和质量信息，但没有修订集合。`emptyPolicy=ALLOW_EMPTY` 且覆盖完整、截止点达标时，门控可视为 `READY`；要求非空的数据集则必需项保持 `BLOCKED`，可选项进入 `READY_WITH_LIMITATION`。
- 终态 `error` 结算为 `FAILED`，可以没有修订，但必须保存错误分类、重试归类和质量旗标；可重试错误在结算前只保留尝试记录。

清单门控是当前投影：必需项全部 `READY` 且可选项全部 `READY` 为 `READY`；必需项未结算、未达目标或为 `DEGRADED/EMPTY/FAILED`（不符合允许空结果规则）时为 `PENDING` 或 `BLOCKED`；必需项达标而任一可选项受限时为 `READY_WITH_LIMITATION`。门控更新不改写结算和修订历史。最终失败或受限结算的旧清单不被覆盖，后续重新获取使用新的清单历史。

### 结算事务与 fencing

Provider 调用在数据库事务外执行。`data-acquisition-worker` 提交结果时执行以下单事务步骤：

1. 锁定获取尝试、清单项和相关观测身份，校验 worker、租约和 fencing token；过期 token 直接返回 `STALE_FENCING`，不写入业务结果。
2. 按 `assertionKey` 幂等写入来源断言，按 `identityKey` 幂等写入数据观测。
3. 对每个观测锁定当前修订指针；按 `revisionDedupKey` 复用修订，或递增 `revisionNo`、插入替代链和来源/输入关联，再更新 `currentRevisionId`。
4. 按清单项唯一约束写入一次结算及其修订集合；重复结算返回已有结算，不修改历史。
5. 聚合父基线项和个性化追加项的结算，更新清单 `gateStatus` 投影，并在达到门控时创建幂等的首页生成任务。

事务提交后才发布 Redis 唤醒。结果重建重放只读取清单结算和修订集合，不访问 Provider，不新增尝试或修订；数据重新获取才创建新的获取尝试。

### 迁移契约

- 新迁移创建上述表、枚举、外键、检查约束、唯一索引、部分唯一索引和运行查询索引。绝对时刻使用 `timestamptz`，交易日/报告期使用 `date` 或显式期间字段；截止点使用版本化结构和规范化键，不使用 `updatedAt` 代替。
- `manifestKey`、`itemKey`、`identityKey`、`assertionKey` 和 `revisionDedupKey` 的 canonicalization 版本必须作为非空字段保存；哈希使用稳定字节序列和明确算法前缀（例如 `sha256:`）。
- 同表 `CHECK` 强制清单 scope 与用户/父清单空值组合；父类型、父门控和追加项冲突在创建事务中锁定并校验。部分唯一索引保证每个修订只有一个 `SELECTED` 来源。
- 对来源断言、观测、修订、修订关联、清单定义、清单项和结算设置 `RESTRICT` 外键，禁止级联删除历史。仅获取尝试的租约、重试和运行字段可更新；可用触发器拒绝其余 UPDATE/DELETE。
- 项目仍处于未部署阶段，不对现有首页 mock 行做兼容回填；迁移可清理旧的临时首页数据后直接建立新结构。旧 `HomePageSnapshot`/`HomePageGenerationTask` 与新清单的连接由后续 Worker seam 票据单独迁移。

## 被拒绝的方案

- 复制基线项或动态读取最新基线：会破坏个性化清单的冻结语义，并把基线更新扇出到用户。
- 在 `DataObservation` 上覆盖当前值：会丢失更正链和历史首页依据。
- 以 EAV 维度表或通用 JSON 血缘取代规范化身份键和强类型关联：唯一性、重放和跨来源查询不可验证。
- 让 Provider 或 C++ Worker 直接写/解释供应商语义：会破坏结算原子性并造成来源、单位和时间规则漂移。

## 后果

清单、来源、观测和修订可以按逻辑键幂等地重试、重放和审计，个性化清单共享基线而不复制数据；代价是需要 canonicalization 版本、部分索引、追加式写入保护和结算事务的跨表校验。后续首页 Worker 只消费已经结算的修订集合，不再现场调用 Provider。

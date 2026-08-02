# 首页 Worker 的清单输入与快照提交接口

## 状态

已采用。

## 决策

`homepage-worker` 复用 C++ 任务生命周期 module，只负责领取、租约、心跳、重试、取消协作和带 fencing 的原子结算。Web 首页 module 负责从 PostgreSQL 装载一份已经封闭的首页数据清单，将其转换为版本化固定输入，并确定性地生成首页快照草稿。C++ 与 Web 之间传递小型版本化信封，不让 C++ 转发或解释数据观测、首页区域和数据集语义。

首页数据清单是生成任务和首页快照的唯一业务输入身份。MVP 不保存 `preferenceFingerprint`；个性化清单直接冻结创建时的偏好内容，个性化当前首页快照按用户唯一。任务、快照和当前投影不得再以独立 `selectionJson`、旧专业市场基线快照 ID 或动态偏好查询补充或改写清单语义。

### 清单封闭与任务身份

- 首页数据清单创建时从 PostgreSQL 全局 sequence 取得不可变 `activationSequence`。序号表达清单的激活先后，不表达任务完成顺序；专业市场基线投影和每个用户的个性化投影只在各自范围内比较序号。
- 只有父基线项与本清单追加项组成的全部有效清单项都进入不可变终态结算后，清单门控才能最终成为 `READY` 或 `READY_WITH_LIMITATION`，并创建首页生成任务。仍在获取中的可选项不能被默认为缺失。
- 可选项失败、降级或合法空结果可以形成 `READY_WITH_LIMITATION`；若不应继续等待某个可选数据集，清单定义必须通过明确的截止和失败结算策略结束该项。
- 生成任务固定 `manifestId`、`activationSequence`、`generationInputContractVersion`、`generatorDefinitionVersion`、`payloadSchemaVersion` 和 `promotionMode`。`promotionMode` 只有 `PROMOTABLE` 与 `HISTORICAL_ONLY`。
- 清单一旦封闭，迟到数据不能改变该任务的输入。结果重建复用原清单的激活序号并默认为 `HISTORICAL_ONLY`；需要用新结果对外晋级时必须创建具有新激活序号的新清单。

偏好写入、旧个性化当前投影失效、该用户未完成个性化任务取消以及新个性化清单创建在同一事务完成。个性化关闭和偏好变化分别使用 `PERSONALIZATION_DISABLED` 与 `PREFERENCE_CHANGED` 作为取消原因。已完成的旧清单与快照保留为不可变历史。幂等性落在偏好写入命令和明确刷新命令上；MVP 不为偏好内容引入指纹、版本或其他替代身份键。首页访问只复用该用户当前未终结的个性化清单，不并行创建第二份清单。

### Worker 请求接口

C++ Worker 向受内部密钥保护的 Web interface 提交版本化请求体：

```json
{
  "contractVersion": "1.0",
  "taskId": "task-id",
  "workerId": "homepage-worker-1",
  "fencingToken": "42"
}
```

`fencingToken` 使用十进制字符串，避免 JSON 数值精度问题。内部密钥只验证调用方身份，不能代替任务执行资格。Web 在装载输入前校验任务仍为 `RUNNING`，且 `workerId` 和 fencing token 完全匹配；资格不匹配返回 `obsolete`。

Web 不在生成期间再次读取当前偏好。偏好变化、个性化关闭或显式取消由对应写入事务把旧任务转为 `CANCELLED` 并记录 `errorCode`；数据库不新增 `OBSOLETE` 状态。新专业市场基线或同一用户的新清单出现时不取消旧任务，旧任务可以完成并保留历史快照，但当前首页快照不得倒退。

### 固定输入装载

Web 装载 module 在一个短只读 `REPEATABLE READ` 事务中完成执行资格校验，并一次性读取任务、首页数据清单、个性化清单的父基线、全部有效清单项、终态结算和固定的数据观测修订集合。装载 module 隐藏 Prisma 和关系表形状，只向生成 module 交付一个版本化 `HomepageGenerationInput`：

- 任务、清单、范围、用户、父基线、目标上下文、激活序号、晋级模式及各 contract/schema 版本；
- 个性化清单创建时冻结的偏好内容；
- 按 `itemKey` 稳定排序的有效清单项，以及每项的要求、终态结算和数据覆盖摘要；
- 按结算关联 `ordinal` 固定的数据观测修订；
- 对规范化完整输入计算的 `inputHash`。

规范对象采用 RFC 8785 JSON Canonicalization Scheme，哈希编码为带算法前缀的 `sha256:<hex>`。数组顺序由信封 schema 明确规定；装载 module 必须先完成稳定排序。`inputHash` 覆盖所有会影响生成结果的字段，但排除任务状态、worker、租约、fencing、装载时间和其他运行信息。

固定输入与哈希生成后立即结束装载事务。首页 payload 在事务外生成，最终提交使用独立写事务重新校验执行资格。

### 确定性生成与结果信封

Web 首页生成 module 是无外部副作用的确定性转换：相同 `HomepageGenerationInput` 与 `generatorDefinitionVersion` 必须生成相同的 payload、`dataCoverage` 和哈希。生成 module 不读取数据库当前投影、当前偏好、数据观测当前修订、系统时间，也不现场调用 Provider、LLM 或其他外部数据源。外部计算结果必须先成为清单固定的数据或修订。

Web 返回以下显式领域结果之一：

- `generated`：携带 `taskId`、`manifestId`、各 contract/schema 版本、`activationSequence`、`promotionMode`、`inputHash`、`payloadHash`、payload 和 `dataCoverage`；
- `obsolete`：任务不再为 `RUNNING`，或 worker/fencing 执行资格已经失效；
- `retryable_failure`：暂时无法得到固定输入或运行依赖暂时不可用；
- `terminal_failure`：版本不兼容或固定输入违反不可恢复的不变量。

稳定错误码只包含：

- `INPUT_NOT_READY`：一致性读取暂未看到完整固定输入；
- `DEPENDENCY_UNAVAILABLE`：数据库或内部运行依赖暂时不可用；
- `CONTRACT_INCOMPATIBLE`：信封、生成定义或 payload schema 主版本不受支持；
- `INPUT_INVARIANT_VIOLATION`：固定修订缺失、顺序重复、哈希不一致或其他不可重试的不变量错误。

具体异常、字段路径和诊断只进入结构化 `details` 与日志。响应显式携带是否可重试，C++ 同时使用允许重试的稳定错误码白名单，避免错误标记改变生命周期语义。HTTP 状态仅表达鉴权、传输和协议问题，不代替领域结果。

`payloadHash` 只覆盖按 RFC 8785 规范化的 payload。`dataCoverage`、身份字段与版本字段参与完整快照的幂等比较，但不混入 `payloadHash`。C++ 只解析外层信封、必填字段、受支持的 contract 主版本和响应体大小，不验证首页区域、数据集、观测语义或重新计算业务哈希。

### 原子提交与当前投影

C++ repository 在一次 PostgreSQL 写事务中完成：

1. `FOR UPDATE` 锁定生成任务，校验任务仍为 `RUNNING`，且 worker、租约和 fencing token 匹配；失败时不写业务结果，并向生命周期 module 返回 `obsolete`。
2. 校验结果中的任务、清单、激活序号、晋级模式、生成定义版本、payload schema 版本和 `inputHash` 与任务绑定完全一致。
3. 以 `generationTaskId` 幂等插入不可变首页快照。若已存在快照，只有全部身份/版本字段、`inputHash`、`payloadHash`、`dataCoverage` JSONB 和 payload JSONB 均相等才视为幂等成功；冲突结果以 `NON_DETERMINISTIC_GENERATION` 终态失败，绝不覆盖历史。
4. 对 `PROMOTABLE` 任务，仅当 `activationSequence` 大于同范围当前投影保存的序号时，条件式推进当前首页快照；未推进不影响任务成功。`HISTORICAL_ONLY` 永不改变当前投影。
5. 将生成任务结算为 `SUCCEEDED`，与快照插入和投影推进共同提交。

首页快照和当前首页快照投影分开建模。快照是不可变事实；投影是当前获准对外服务的引用。专业市场基线只有一个当前投影，代码和数据库枚举统一使用 `BASELINE`，不再使用 `DEFAULT`。个性化当前投影按 `userId` 唯一。

读取时先检查该用户的个性化当前投影；没有时回退专业市场基线当前投影。同一用户的个性化快照如果固定了旧专业市场基线，仍可服务并标记 `baselineOutdated`，同时触发新清单。专业市场基线投影在新版本提交前自然继续指向旧快照，因此不需要再查询“旧基线”。偏好写入事务已经使旧个性化投影失效，读取路径不通过动态偏好比较猜测快照是否适用。

首页快照不再保存含义模糊的单一 `dataAsOf`。`dataCoverage` 按有效清单项表达 `datasetKey`、目标与实际数据截止点、结算状态和限制；首页区域可继续展示自己的业务日期。`generatedAt` 由提交事务写入，只表示快照生成时间，不参与 payload、哈希或激活排序。

读取信封包含 `source`（`BASELINE` 或 `PERSONALIZED`）、`snapshotId`、`manifestId`、`generatedAt`、`dataCoverage`、`personalizationPending`、`baselineOutdated`、`refreshInProgress` 和 payload。它不暴露任务状态、fencing 或内部错误码，也不保留含义过载的 `isStale`。

### 版本升级

任务始终使用创建时固定的生成定义和 payload schema 版本。Web 不支持相应主版本时返回 `CONTRACT_INCOMPATIBLE`，不得让旧任务自动改用新定义。需要新定义结果时，为原清单创建 `HISTORICAL_ONLY` 重建任务；若结果需要对外晋级，则创建带新激活序号的新清单。

项目尚未部署，首次迁移直接删除旧 mock 首页生成任务和快照，移除 `selectionJson`、`preferenceFingerprint`、`baselineDefaultSnapshotId` 和首页级 `dataAsOf` 等旧输入/读取语义，不建立兼容字段、双写或旧 contract 转换层。

### 契约测试边界

- Web 装载 module 的 PostgreSQL 契约测试验证父基线展开、清单项稳定顺序、冻结偏好、修订集合、覆盖摘要和 `inputHash`。
- Web 生成 module 的纯内存契约测试验证同一输入得到相同草稿与哈希，并通过依赖结构保证其不能动态访问数据库、Provider、LLM 或系统时钟。
- C++ internal client 测试只覆盖请求/响应信封版本、四种领域结果、稳定错误映射和响应大小限制。
- C++ repository 的 PostgreSQL 契约测试覆盖 fencing、幂等重放、非确定性冲突、不可变历史、激活序号竞争、`HISTORICAL_ONLY` 和投影只前进不倒退。
- Docker 集成测试只保留一次完整内部调用与原子提交链路，不重复穷举业务组合；本项目不进行浏览器验证。

## 被拒绝的方案

- 由 C++ Worker 装载或转发完整修订数据：会让 C++ 理解频繁变化的 Web 业务结构，形成浅层中转 module。
- 让 Web 在生成期间动态读取当前偏好或观测：会破坏固定输入、重试和结果重建的确定性。
- 以 `generatedAt`、完成顺序或数据日期选择当前快照：并发晚完成的旧任务可能使当前投影倒退。
- 清单必需项完成后立即生成、让可选项迟到补充：同一任务会随时间产生不同 `inputHash` 和 payload。
- 用首页级单一 `dataAsOf` 代表异构数据：会把热力图交易日错误地冒充所有数据集的截止点。
- 以 `(userId, preferenceFingerprint)` 标识个性化投影：MVP 不需要为偏好内容引入额外身份与失效复杂度，偏好写入事务已经提供明确的切换 seam。

## 后果

首页生成成为一个可重放、可哈希、可通过纯内存夹具验证的深 module；C++ 生命周期和 PostgreSQL 原子提交保持通用而稳定。代价是清单必须等待全部有效项终态、偏好修改必须走统一事务 seam，并新增当前首页快照投影、激活序号、输入/结果版本与规范化哈希约束。

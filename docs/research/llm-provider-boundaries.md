# 四维 LLM 评估候选模型与供应商能力边界

研究基准日：2026-08-02  
对应议题：[核定四维评估候选模型与供应商能力边界](https://github.com/itsadrianxv/AlphaFlow/issues/23)  
依赖决议：[核定中国大陆研究模式的合规与数据治理边界](https://github.com/itsadrianxv/AlphaFlow/issues/8)、[定义四维 LLM 分发评估与确定性门控](https://github.com/itsadrianxv/AlphaFlow/issues/12)

## 结论摘要

1. **首选候选是 OpenAI API 与 Anthropic Claude API 的商业/企业端同步接口**。二者都能在服务端声明 JSON Schema，并由代码继续做结构、数值范围、引用 ID 闭合和不确定性校验。两者都有不用于训练的商业 API 政策，但零留存、地域处理和端点资格需要按组织和合同启用，不能只看供应商名称。
2. **Google Gemini 只能使用 Paid Services 或 Vertex AI 的受控项目**。其结构化输出支持 JSON Schema 子集，仍须承担应用层语义校验；免费配额/AI Studio Unpaid Services 明确允许用于产品改进和训练并可能人工审阅，禁止进入 `research_only` 私测数据链。
3. **阿里云百炼/Qwen 是中国区部署候选，但公开资料只证明 JSON Mode，不证明严格 JSON Schema 或统一 API 不训练/零留存**。在取得按租户、地域、端点签署的数据处理/训练条款前，只能发送公开或去标识化材料；原始私测证据应走企业合同、专有实例或自托管方案。
4. **DeepSeek 与智谱 GLM 不作为原始私测数据的默认候选**。官方接口分别只有 JSON Output/JSON Mode，需代码二次校验；公开隐私政策允许或未排除匿名化数据用于改进/训练，且没有可直接验收的 API ZDR 承诺。它们可用于公开数据基准或去标识化实验，但不能被配置成“默认安全”。
5. **批处理不是默认安全优化**：它会把输入、输出和结果文件持久化到服务商端。[Anthropic Batch](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing) 明确保留结果 29 天且不符合 ZDR；[Gemini Batch](https://ai.google.dev/gemini-api/docs/batch-api) 结果默认可下载 6 周；[OpenAI `/v1/batches`](https://platform.openai.com/docs/guides/your-data) 是需删除的应用状态。MVP 的私测评估默认采用同步接口、平台外部队列和短生命周期快照；批处理只有在 `retention_class`、合同和删除验收均通过后才可启用。

## 评估标准

本报告将 #12 的契约拆成可验收边界：

- 全局调用一次返回重要性、置信度、信息增量；用户调用一次返回相关性。
- 输出必须能表达 `score: 0–4|null`、1–3 条原子依据、输入 ID 引用、不确定性和无数字摘要；LLM 不返回总分、等级或渠道建议。
- 输入是冻结的事件修订、证据快照、相关研究认知基线以及（仅相关性调用）用户研究偏好快照；供应商不能自行检索补证。
- 应用必须在供应商响应之后校验 JSON Schema、分值整数范围、`null` 语义、引用对象类型和双边引用闭合。结构化输出只解决“形状”，不证明事实为真。
- `research_only` 不采集个人资产/持仓，不发送买卖动作；供应商数据权利、训练政策、留存和跨境处理仍须按 #8 的上线阻断清单验证。

## 能力比较

| 候选 | 结构化输出与中文/上下文 | 批处理、缓存、限流 | 价格/地域（官方动态页面） | 输入输出保留与训练 | 对私测契约的判定 |
| --- | --- | --- | --- | --- | --- |
| [OpenAI API（GPT-5.6 Terra/Luna 等）](https://platform.openai.com/docs/models) | [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs) 保证遵守自定义 JSON Schema；最新模型页面声明支持多语言文本。模型、上下文与快照以 Models 页面为准。 | [Batch](https://platform.openai.com/docs/guides/batch)：JSONL、同步价 50%、通常/最迟 24h，单批 50,000 请求/200 MB、每小时可建 2,000 批；[Prompt Caching](https://platform.openai.com/docs/guides/prompt-caching) 对约 1,024 token 以上精确前缀自动生效，GPT-5.6+ 可显式断点/key；[限流](https://platform.openai.com/docs/guides/rate-limits) 按 RPM/RPD/TPM/TPD 等先到者限制，Batch 队列 token 另计。 | [价格](https://platform.openai.com/docs/pricing) 按百万 token，给出标准、Batch、缓存和区域处理加价；[数据驻留](https://platform.openai.com/docs/guides/your-data) 含 US、EU、UK、JP、CA、KR、SG、IN、AU、UAE，不含中国大陆。 | [Your data](https://platform.openai.com/docs/guides/your-data)：API 数据默认不用于训练；滥用监控日志默认最多 30 天。获批组织可启用 ZDR/MAM，但 `/v1/batches`、文件、会话等状态端点仍有独立留存规则。 | **首选（条件通过）**：用同步 Responses/Chat + 已获批 ZDR/MAM；禁用 Files、Conversations、Batch 和外部工具；逐请求保存 policy snapshot。跨境到 US/EU 必须通过 #8 的合同和法律评估。 |
| [Anthropic Claude API（Sonnet/Haiku/Opus）](https://docs.anthropic.com/en/docs/about-claude/models/overview) | Claude 4.5+ 的 [JSON outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs) 使用 `output_config.format` + JSON Schema，strict tool use 可约束工具参数；模型页声明多语言，[多语言页](https://docs.anthropic.com/en/docs/build-with-claude/multilingual-support) 给出简体中文相对英文评测；新一代模型最高 1M context，部分为 200k。 | [Message Batches](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing)：同步价 50%、多数 <1h、24h 到期，单批 100,000 请求/256 MB；[Prompt Cache](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) 默认 5 分钟，可选 1 小时，缓存命中多数模型不计入 ITPM；[限流](https://docs.anthropic.com/en/api/rate-limits) 按 RPM/ITPM/OTPM、429 附 `retry-after`。 | [价格](https://docs.anthropic.com/en/docs/about-claude/pricing) 动态列出 Sonnet/Haiku/Opus 的输入输出价；[地域](https://docs.anthropic.com/en/docs/build-with-claude/data-residency) `inference_geo` 仅 `us` 或 `global`，workspace geo 当前仅 US，US-only 处理约 1.1 倍价格；没有中国区。 | [API and data retention](https://docs.anthropic.com/en/manage-claude/api-and-data-retention)：商业 API 默认不以客户输入输出训练，标准 API 输入输出通常 30 天内删除；可申请 ZDR。Batch 不属 ZDR，结果最多 29 天；Fable/Mythos 等 Covered Models 要求 30 天，不能 ZDR；安全标记/法律留置可延长。 | **首选（条件通过）**：只用同步 Messages + ZDR、非 Covered Model；禁用 Batch/Files/状态工具；要求 `inference_geo=us` 并接受跨境评估。 |
| [Google Gemini API / Vertex AI](https://ai.google.dev/gemini-api/docs/structured-output) | Gemini Structured Output 支持 JSON Schema 子集（对象、数组、枚举、`null` 等）；官方要求应用自行验证语义。模型文档需逐版确认上下文和中文效果，不能把“多语言”当作 A 股术语保证。 | [Gemini Batch](https://ai.google.dev/gemini-api/docs/batch-api)：50%、目标 24h，inline <20 MB 或 JSONL 2 GB，独立批量配额；[缓存](https://ai.google.dev/gemini-api/docs/caching) Gemini 2.5+ 默认隐式，GenerateContent 还可显式设置 TTL；[限流](https://ai.google.dev/gemini-api/docs/rate-limits) 按项目 RPM、输入 TPM、RPD/TPD 等，Batch 并发默认 100，额度随 usage tier 变化。 | [价格](https://ai.google.dev/gemini-api/docs/pricing) 为动态美元/M token；[Vertex 地域](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations) 有区域/美国或欧盟多区域端点，global endpoint 不保证处理/驻留地区。[available-regions](https://ai.google.dev/gemini-api/docs/available-regions) 页面不包含中国大陆，需单独核验 Vertex 访问条件。 | [Terms](https://ai.google.dev/gemini-api/terms)：Unpaid Services（AI Studio 或无计费配额）允许 Google 使用输入/输出改进和训练并人工审阅；Paid Services 不用于产品改进，但为安全/法律可在有限期间记录或在 Google/代理设施所在国家缓存。[开发者日志](https://ai.google.dev/gemini-api/docs/logs-policy) 仅在计费项目主动启用，默认最长 55 天且默认不用于产品改进；向 Google 分享数据集则可用于训练且没有固定留存期。 | **条件候选**：仅 Paid Cloud Project 或 Vertex + DPA/区域端点；禁用 Unpaid、日志/数据集分享、Grounding、Batch 和 Files；结构化响应必须应用层二次校验。 |
| [阿里云百炼/Qwen](https://help.aliyun.com/zh/model-studio/getting-started/models) | 官方 [JSON Mode](https://help.aliyun.com/zh/model-studio/json-mode) 为 `response_format={type:json_object}`，要求提示包含 JSON；部分思考模式不保证严格 JSON Schema。模型页和地域页显示中文模型及北京、新加坡、东京、法兰克福、弗吉尼亚等可用区，需按模型核对。 | [Batch](https://www.alibabacloud.com/help/en/model-studio/batch-inference) 使用 UTF-8 JSONL，常见上限 50,000 请求/500 MB，成功请求按实时价 50%；[上下文缓存](https://www.alibabacloud.com/help/en/model-studio/context-cache) 折扣不能与批处理同时生效，显式命中有效期 5 分钟、隐式命中不保证；[限流](https://help.aliyun.com/zh/model-studio/rate-limit) 可能同时有 RPM/TPM 与 RPS/TPS 突发保护。 | [价格](https://www.alibabacloud.com/help/en/model-studio/model-pricing) 按地域和模型动态变化，Batch 半价；北京/新加坡等 API key/base URL 分离。 | [Model Studio data privacy](https://www.alibabacloud.com/help/en/model-studio/data-privacy) 公开文档未给出可直接验收的“API 输入输出不训练/零留存”统一承诺；通用隐私说明不能替代租户、端点、日志和训练条款。 | **中国区条件候选**：只在企业合同/专有实例明确训练、日志和地域后使用；默认只发送公开/去标识化事件；代码必须把 JSON Mode 当非严格输出并强制 Schema 校验。 |
| [DeepSeek API](https://api-docs.deepseek.com/quick_start/pricing) | [JSON Mode](https://api-docs.deepseek.com/guides/json_mode) 只保证有效 JSON 字符串，不是严格 JSON Schema；官方价格页当前列出最高 1M context，中文可用性没有官方 A 股评测。 | 默认[磁盘 KV cache](https://api-docs.deepseek.com/guides/kv_cache)，要求完整匹配前缀，通常数小时至数天清理；[账号并发限流](https://api-docs.deepseek.com/quick_start/rate_limit)，超限 429，可用 `user_id` 隔离缓存；本次检索未找到等价官方 Batch/提示缓存保留控制。 | 价格按百万 token 动态列示（如 v4 Flash/Pro cache-hit、miss、output）；服务地域和实际处理位置需按 API 合同确认。 | [隐私政策](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html) 允许在加密、去标识化前提用于训练/服务优化；中国境内运营信息存境内并按必要期限保留；没有 API ZDR/不训练承诺。 | **不作为原始私测候选**：仅公开或去标识化数据；若取得企业书面不训练/留存条款，再重新验收。 |
| [智谱 GLM API](https://docs.bigmodel.cn/cn/guide/start/model-overview) | [JSON Mode](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)，不提供供应商级严格 Schema 解码；模型文档建议应用自行 JSON Schema 校验。模型页列 128K 至 1M 等不同上下文，须按具体版本核对。 | [JSONL Batch](https://docs.bigmodel.cn/cn/guide/tools/batch) 五折、单文件常见 50,000 请求/100 MB；[隐式缓存](https://docs.bigmodel.cn/cn/guide/capabilities/cache) 自动识别重复前缀并在 usage 返回命中 token；具体 RPM/TPM、价格和模型能力随页面动态更新。 | 中国区服务与[价格页](https://bigmodel.cn/pricing)为主，地域和模型可用性需按账户核验。 | [隐私政策](https://docs.bigmodel.cn/cn/terms/privacy-policy) 称境内运营收集信息存储境内、按最短必要期限保留；匿名化数据可用于产品改进/模型训练，未给 API ZDR 统一承诺。 | **不作为原始私测候选**：公开/去标识化实验可用；企业合同或私有部署完成训练、日志、删除验收后才可扩大范围。 |

## 供应商边界与实现规则

### 1. 以端点策略而不是供应商名判断

评估配置必须同时记录 `provider`、`endpoint`、`model_id`、`account_class`、`region`、`retention_class`、`training_policy_snapshot`、`prompt_cache_policy` 和 `batch_policy`。同一供应商的同步接口、Batch、Files、会话、Grounding、控制台和第三方云平台可能有不同数据处理者与留存规则，不能共享一个 `safe=true` 字段。

建议至少定义以下策略值：

| 策略 | 可发送内容 | 必要控制 |
| --- | --- | --- |
| `sync_zdr` | 冻结后的去标识化事件、证据片段、认知基线；不含个人身份、持仓、资产和供应商受限原文 | 商业 API、ZDR/MAM 合同、同步端点、无状态参数、服务端 JSON/ref 校验；缓存只放稳定公共提示前缀 |
| `paid_non_zdr` | 仅在权利台账和合同允许的最小研究材料 | 明确 30 天/短期日志及删除责任；禁止把 `null` 或技术失败伪装成低分 |
| `batch_queued` | 默认不允许原始私测材料 | 只有供应商书面批准留存期限、可删除、结果下载和跨境范围后启用，并给事件评估记录加 retention 标记 |
| `unpaid_training` | 禁止任何 research_only 私测内容 | 只用于公开样例或脱敏基准，不能用于生产评分 |

### 2. 批处理与缓存的取舍

- 全局评估量大时可把公开基准放进 Batch；但 #12 的事件修订和证据快照属于需可重放的研究记录，MVP 默认使用同步调用并由自己的队列控制重试。
- Prompt/context cache 只缓存稳定的评分指令、Schema 和公共量表；事件证据、用户偏好、研究认知基线放在缓存断点之后或禁用缓存。缓存命中不能被当作数据不留存证明。
- Anthropic Structured Outputs 的 Schema 语法缓存、OpenAI Prompt Cache 的 KV 状态、Gemini/百炼显式缓存对象都必须在评估记录中保存供应商政策版本和过期时间；不把缓存 token 当成研究证据。

### 3. 中文与结构语义验收

供应商的“多语言”声明只证明模型可处理多语文本，不能证明 A 股公司简称、公告口径、财务期间、行业术语或中文引用片段的精度。上线前固定一组中文事件样例，至少验收：

- 四维整数/`null`、不输出总分和渠道建议；
- `reasons` 能区分输入事实与推断；每条 `evidence_refs` 都指向冻结输入中的真实 ID；
- 重要性、置信度、信息增量引用全局对象，相关性同时引用事件关系和用户偏好；
- 供应商返回合法 JSON 但语义错误、引用越权或证据不足时，代码将其判为技术失败或合法 `null`，绝不自动降为 `0`。

## 可执行的 MVP 路由结论

1. 先实现一个 `ProviderAdapter` 合同测试，覆盖 OpenAI Structured Outputs 与 Anthropic JSON outputs；两个适配器都走同步、固定模型快照、应用层 Schema/ref 校验和有界重试。
2. 用 OpenAI 作为默认高吞吐/成本平衡候选，用 Anthropic Sonnet/Haiku 作为独立质量对照；具体模型和价格从运行时能力注册表读取，不把本报告的价格快照写死。
3. Google 只在 Paid/Vertex 项目和区域/DPA 验收完成后接入；Qwen 只在中国区合同/私有部署边界清楚后接入。DeepSeek、GLM 暂留公开脱敏基准，不进入原始私测证据路径。
4. 不在本票决定最终供应商路由、预算或多模型投票；后续任务应基于本报告的 `retention_class`、模型快照、限流和成本约束制定路由与容量预算。

## 官方一手资料

以下链接均为供应商官方文档、价格页或隐私/数据政策；价格、模型和限额会变更，实施时必须保存页面版本/抓取时间。

### OpenAI

- [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Batch API](https://platform.openai.com/docs/guides/batch)
- [Prompt caching](https://platform.openai.com/docs/guides/prompt-caching)
- [Rate limits](https://platform.openai.com/docs/guides/rate-limits)
- [Your data / retention / data residency](https://platform.openai.com/docs/guides/your-data)
- [API pricing](https://platform.openai.com/docs/pricing)
- [Models](https://platform.openai.com/docs/models)

### Anthropic

- [Structured outputs](https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs)
- [Message Batches](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing)
- [Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [Rate limits](https://docs.anthropic.com/en/api/rate-limits)
- [Models overview](https://docs.anthropic.com/en/docs/about-claude/models/overview)
- [Multilingual support](https://docs.anthropic.com/en/docs/build-with-claude/multilingual-support)
- [API and data retention](https://docs.anthropic.com/en/manage-claude/api-and-data-retention)
- [Data residency](https://docs.anthropic.com/en/docs/build-with-claude/data-residency)
- [Pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [Commercial data / training policy](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)

### Google Gemini / Vertex AI

- [Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Batch API](https://ai.google.dev/gemini-api/docs/batch-api)
- [Context caching](https://ai.google.dev/gemini-api/docs/caching)
- [Explicit caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API terms and paid/unpaid data use](https://ai.google.dev/gemini-api/terms)
- [Data logging and sharing](https://ai.google.dev/gemini-api/docs/logs-policy)
- [Available regions](https://ai.google.dev/gemini-api/docs/available-regions)
- [Vertex AI endpoint locations](https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)

### 阿里云百炼 / Qwen

- [JSON Mode](https://help.aliyun.com/zh/model-studio/json-mode)
- [Batch inference](https://www.alibabacloud.com/help/en/model-studio/batch-inference)
- [Context Cache](https://www.alibabacloud.com/help/en/model-studio/context-cache)
- [Rate limits](https://help.aliyun.com/zh/model-studio/rate-limit)
- [Models and pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Model availability by region](https://help.aliyun.com/zh/model-studio/getting-started/models)
- [Model Studio data privacy](https://www.alibabacloud.com/help/en/model-studio/data-privacy)

### DeepSeek

- [JSON Mode](https://api-docs.deepseek.com/guides/json_mode)
- [KV cache](https://api-docs.deepseek.com/guides/kv_cache)
- [Rate limits](https://api-docs.deepseek.com/quick_start/rate_limit)
- [Pricing and context](https://api-docs.deepseek.com/quick_start/pricing)
- [Privacy policy](https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html)

### 智谱 GLM

- [Structured output / JSON Mode](https://docs.bigmodel.cn/cn/guide/capabilities/struct-output)
- [Batch](https://docs.bigmodel.cn/cn/guide/tools/batch)
- [Cache](https://docs.bigmodel.cn/cn/guide/capabilities/cache)
- [Model overview](https://docs.bigmodel.cn/cn/guide/start/model-overview)
- [Pricing](https://bigmodel.cn/pricing)
- [Privacy policy](https://docs.bigmodel.cn/cn/terms/privacy-policy)

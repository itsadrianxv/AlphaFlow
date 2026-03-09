# Stock Screening Python Service

Python FastAPI 微服务，向主应用提供 AkShare 数据接口。

## 能力概览

- 股票基础数据：代码列表、批量行情、历史指标、行业列表
- Workflow 情报数据：主题资讯、候选股、公司证据（含批量）
- 主题词 -> A 股概念映射：白名单/黑名单 + 智谱 Web Search + 本地自动匹配
- 智能降级：AkShare 请求失败时优先读缓存，再走兜底数据
- 统一网关缓存：`L1 内存缓存 + L2 Redis 缓存 + stale fallback`
- 管理任务：`refresh-universe`、`refresh-concepts`、`prewarm-hot-themes`
- 基础可观测性：provider latency / error、cache hit、stale fallback、batch success 等指标

## 目录结构

```text
python_services/
  app/
    main.py
    contracts/
      admin.py
    routers/
      admin_jobs.py
      stock_data.py
      intelligence_data.py
      market_data.py
      intelligence_v1.py
    gateway/
      common.py
      market_gateway.py
      intelligence_gateway.py
    infrastructure/
      cache/
        memory_cache.py
        redis_cache.py
      metrics/
        recorder.py
    jobs/
      refresh_universe.py
      refresh_concepts.py
      prewarm_hot_themes.py
    services/
      akshare_adapter.py
      intelligence_data_adapter.py
      zhipu_search_client.py
      theme_concept_rules_registry.py
  tests/
  requirements.txt
```

## 启动

```bash
cd python_services
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 关键接口

保留兼容：

- `GET /api/intelligence/news?theme&days&limit`
- `GET /api/intelligence/candidates?theme&limit`
- `GET /api/intelligence/evidence/{stock_code}?concept`
- `POST /api/intelligence/evidence/batch`

新增：

- `GET /api/intelligence/concepts/match?theme=...&limit=...`
- `GET /api/intelligence/concepts/rules?theme=...`
- `PUT /api/intelligence/concepts/rules`
- `GET /api/admin/metrics`
- `POST /api/admin/jobs/refresh-universe`
- `POST /api/admin/jobs/refresh-concepts`
- `POST /api/admin/jobs/prewarm-hot-themes`

标准化 v1：

- `GET /api/v1/market/stocks/{stockCode}`
- `POST /api/v1/market/stocks/batch`
- `GET /api/v1/market/themes/{theme}/candidates`
- `GET /api/v1/intelligence/themes/{theme}/news`
- `GET /api/v1/intelligence/themes/{theme}/concepts`
- `GET /api/v1/intelligence/stocks/{stockCode}/evidence`

## 概念匹配优先级

1. 白名单优先（命中即优先返回）
2. 黑名单强过滤（对白名单、智谱、本地匹配都生效）
3. 无白名单命中时，调用智谱 Web Search
4. 智谱失败或无结果时，回退本地自动匹配

## 环境变量

缓存与降级：

- `INTELLIGENCE_CACHE_TTL_SECONDS`：新鲜缓存 TTL（默认 `300`）
- `INTELLIGENCE_CACHE_STALE_SECONDS`：过期后可继续回退的 stale 窗口（默认 `1800`）
- `INTELLIGENCE_SPOT_CACHE_TTL_SECONDS`：股票快照缓存 TTL（默认 `120`）
- `INTELLIGENCE_ENABLE_MOCK_FALLBACK`：是否启用兜底数据（默认 `true`）
- `GATEWAY_REDIS_URL`：Redis 连接串，配置后启用 L2 分布式缓存（可选）
- `GATEWAY_REDIS_PREFIX`：Redis key 前缀（默认 `gateway-cache`）
- `GATEWAY_HOT_THEMES`：热门主题预热回退列表，逗号分隔（默认 `AI,算力,机器人`）

智谱 Web Search：

- `ZHIPU_API_KEY`：智谱 API Key（启用外部搜索时必需）
- `ZHIPU_WEB_SEARCH_MODEL`：模型名（可选，默认 `glm-4-plus`）
- `ZHIPU_WEB_SEARCH_TIMEOUT_SECONDS`：请求超时秒数（可选，默认 `8`）
- `ZHIPU_WEB_SEARCH_RETRIES`：失败重试次数（可选，默认 `2`）

规则存储：

- `INTELLIGENCE_THEME_CONCEPT_RULES_FILE`：规则 JSON 文件路径（可选，默认 `app/services/data/theme_concept_rules.json`）

## 接口示例

### 1) 主题匹配

请求：

```bash
curl "http://localhost:8000/api/intelligence/concepts/match?theme=算力&limit=3"
```

响应：

```json
{
  "theme": "算力",
  "matchedBy": "whitelist",
  "concepts": [
    {
      "name": "算力租赁",
      "code": "BK1234",
      "aliases": ["算力服务"],
      "confidence": 0.99,
      "reason": "命中白名单概念：算力租赁",
      "source": "whitelist"
    }
  ]
}
```

### 2) 查询规则

请求：

```bash
curl "http://localhost:8000/api/intelligence/concepts/rules?theme=算力"
```

响应：

```json
{
  "theme": "算力",
  "whitelist": ["算力租赁"],
  "blacklist": ["云计算"],
  "aliases": ["算力基础设施"],
  "updatedAt": "2026-03-07T10:00:00+00:00"
}
```

### 3) 更新规则

请求：

```bash
curl -X PUT "http://localhost:8000/api/intelligence/concepts/rules" \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "算力",
    "whitelist": ["算力租赁", "液冷服务器"],
    "blacklist": ["泛云服务"],
    "aliases": ["算力基础设施"]
  }'
```

响应结构与查询规则一致。

## 管理任务示例

### 4) 刷新全市场基础缓存

```bash
curl -X POST "http://localhost:8000/api/admin/jobs/refresh-universe" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 200}'
```

### 5) 刷新概念板块与成分股缓存

```bash
curl -X POST "http://localhost:8000/api/admin/jobs/refresh-concepts" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100}'
```

### 6) 预热热门主题缓存

```bash
curl -X POST "http://localhost:8000/api/admin/jobs/prewarm-hot-themes" \
  -H "Content-Type: application/json" \
  -d '{"maxThemes": 5, "evidencePerTheme": 3}'
```

### 7) 查看基础 metrics

```bash
curl "http://localhost:8000/api/admin/metrics"
```

## 测试

```bash
cd python_services
pytest
```

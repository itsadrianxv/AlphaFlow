# Docker 部署说明

本项目只支持 Docker Compose 运行。所有运行时环境变量统一放在 `docker/.env`，根目录 `.env*` 不再使用。

## 服务

- `web`: Next.js 应用，项目根在容器内为 `/repo/web`
- `workflow-worker`: 工作流后台执行器
- `python-service`: FastAPI 金融数据与情报网关
- `kronos-service`: Kronos 预测服务
- `agent-runtime`: Pi Agent Harness sidecar
- `redis`: 运行时缓存与队列
- `postgres`: PostgreSQL 数据库

## 准备环境变量

从仓库根目录执行：

```bash
cp docker/.env.example docker/.env
```

最低需要配置：

- `AUTH_SECRET`
- `POSTGRES_PASSWORD`
- `WEB_PORT`
- `PYTHON_SERVICE_PORT`
- `POSTGRES_PORT`

可选配置：

- `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY`
- `TAVILY_API_KEY`
- `ZHIPU_API_KEY`
- `TUSHARE_TOKEN`
- `TUSHARE_API_URL`（默认 `https://api.tushare.pro`；使用代理时可配置为 `https://teajoin.com`）
- `MINISHARE_TOKEN`（新闻短讯/快讯；只配置在 `docker/.env`，不得提交）
- `REFCHECKER_*`
- `AGENT_RUNTIME_MODEL_*`

## 启动

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

启动后：

- Web: `http://localhost:3000`
- Python API Docs: `http://localhost:8000/docs`
- Kronos API: `http://localhost:8010`
- Agent Runtime: `http://localhost:8020/health`
- PostgreSQL: `localhost:5432`

## 常用命令

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f web
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f workflow-worker
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f agent-runtime
docker compose --env-file docker/.env -f docker/docker-compose.yml down
docker compose --env-file docker/.env -f docker/docker-compose.yml down -v
```

## 刷新 THS 概念目录

容器内默认路径为 `/app/data/ths_concept_catalog.csv`，宿主机路径为仓库根目录下的 `data/ths_concept_catalog.csv`。

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm python-service python scripts/refresh_concept_catalog.py --output /app/data/ths_concept_catalog.csv
```

更新 `data/ths_concept_catalog.csv` 后无需重建镜像，后续请求会按文件更新时间自动热加载。

## 刷新筛选股票池

筛选页和自选股页的股票搜索只读取 `data/screening_stock_universe.json`。请在宿主机配置 Cron，以中国时区的每个工作日 18:00 触发；任务会再用 TuShare `trade_cal` 判断是否为 A 股交易日，节假日会正常跳过。

```cron
TZ=Asia/Shanghai
0 18 * * 1-5 cd /path/to/stock-screening-boost && docker compose --env-file docker/.env -f docker/docker-compose.yml exec -T python-service python -m app.jobs.refresh_screening_stock_universe >> /var/log/alphaflow-screening-universe.log 2>&1
```

首次部署后可手动执行同一条 `docker compose ... exec` 命令生成股票池。刷新失败时，任务会保持最后一次成功文件不变并以非零退出状态结束。

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml exec -T python-service python -m app.jobs.refresh_screening_stock_universe
```

## 刷新 A 股概念热力图

热力图快照在每个交易日午间和收盘后刷新。任务会通过 `trade_cal` 自动跳过非交易日，午间优先使用 `rt_min`，收盘后使用日线正式数据。将以下任务加入宿主机 cron：

```cron
TZ=Asia/Shanghai
35 11 * * 1-5 cd /path/to/stock-screening-boost && docker compose --env-file docker/.env -f docker/docker-compose.yml exec -T python-service python -m app.jobs.refresh_market_heatmap >> /var/log/alphaflow-heatmap.log 2>&1
10 15 * * 1-5 cd /path/to/stock-screening-boost && docker compose --env-file docker/.env -f docker/docker-compose.yml exec -T python-service python -m app.jobs.refresh_market_heatmap >> /var/log/alphaflow-heatmap.log 2>&1
```

## 配置校验

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml config
```

Minishare 新闻在 Python 网关内使用 DeepSeek 做事件分类、情绪与相关度重排；因此还需要配置 `DEEPSEEK_API_KEY`。新闻 Token、Minishare 响应或重排调用异常时，新闻接口会明确报错，不会静默返回空数据。

`web` 容器启动时会依次执行：

```bash
npm run validate:runtime
npm run db:push -- --accept-data-loss
npm run dev
```

`workflow-worker` 容器启动时会执行：

```bash
npm run validate:runtime
npm run worker:workflow
```

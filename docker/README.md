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

## 配置校验

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml config
```

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

# AlphaFlow

AlphaFlow 是面向股票投研场景的智能工作流平台，整合选股筛选、行业研究、公司研究、择时分析、异步工作流和 Python 数据服务。

本仓库只支持 Docker Compose 运行。Web/Next/T3 项目已经收敛到 `web/` 子目录，根目录不再作为 Node 项目根使用。

## 项目结构

```text
.
├── docker/            # Docker Compose、镜像和唯一运行入口配置
├── python_services/   # FastAPI、Kronos 等 Python 服务
├── web/               # Next.js / T3 / Prisma / worker 子项目
├── data/              # 本地数据文件
├── docs/              # 项目文档
└── config/            # 共享配置
```

## 快速启动

先准备 Docker 环境变量：

```bash
cp docker/.env.example docker/.env
```

然后从仓库根目录启动：

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

默认访问地址：

- Web: `http://localhost:3000`
- Python API Docs: `http://localhost:8000/docs`
- Kronos API: `http://localhost:8010`
- PostgreSQL: `localhost:5432`

## 常用命令

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml ps
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f web
docker compose --env-file docker/.env -f docker/docker-compose.yml logs -f workflow-worker
docker compose --env-file docker/.env -f docker/docker-compose.yml down
docker compose --env-file docker/.env -f docker/docker-compose.yml down -v
```

## 环境变量

唯一受支持的环境变量文件是 `docker/.env`。

根目录 `.env`、`.env.local`、`.env.example` 不再使用，也不应重新添加。Web 容器和 worker 容器的运行时变量由 `docker/docker-compose.yml` 从 `docker/.env` 注入。

最低需要确认：

- `AUTH_SECRET`
- `POSTGRES_PASSWORD`
- `WEB_PORT`
- `PYTHON_SERVICE_PORT`
- `POSTGRES_PORT`

可选能力变量：

- `DEEPSEEK_API_KEY`
- `FIRECRAWL_API_KEY`
- `TAVILY_API_KEY`
- `ZHIPU_API_KEY`
- `IFIND_USERNAME` / `IFIND_PASSWORD`
- `TUSHARE_TOKEN`
- `REFCHECKER_*`

## Web 子项目

Web 项目位于 `web/`，包括：

- `web/app`: Next.js App Router
- `web/server`: 服务端应用、领域、基础设施和 API
- `web/trpc`: tRPC 客户端和服务端桥接
- `web/prisma`: Prisma schema 和 migrations
- `web/tooling`: runtime 校验、测试配置和 worker 入口

正常使用不需要在宿主机执行 npm 命令；Docker 容器会在 `web/` 内运行 `npm ci`、`prisma generate`、`db:push`、`next dev` 和 `workflow-worker`。

## 验证

结构或配置变更后，建议执行：

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml config
docker compose --env-file docker/.env -f docker/docker-compose.yml up -d --build
```

如果需要在容器内运行 Web 检查：

```bash
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm web npm run typecheck
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm web npm test
docker compose --env-file docker/.env -f docker/docker-compose.yml run --rm web npm run check
```

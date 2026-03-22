# Docker Desktop 部署说明

本目录提供完整的 Docker Compose 编排，用于启动以下服务：

- `web`: Next.js 应用
- `python-service`: FastAPI 金融与情报数据网关
- `workflow-worker`: 工作流执行器
- `screening-worker`: 筛选任务执行器
- `redis`: 运行时缓存与队列
- `postgres`: PostgreSQL 数据库

## 前置条件

- 已安装并启动 Docker Desktop
- `docker version` 和 `docker compose version` 可以正常执行

## 1. 准备环境变量

先创建本地部署配置：

```bash
cp deploy/.env.example deploy/.env
```

最低必填项：

- `AUTH_SECRET`
- `POSTGRES_PASSWORD`
- `WEB_PORT` / `PYTHON_SERVICE_PORT` / `POSTGRES_PORT`

建议同时配置：

- `DEEPSEEK_API_KEY`: 启用工作流摘要、Insight 增强等能力
- `FIRECRAWL_API_KEY`: 启用公司研究网页抓取
- `ZHIPU_API_KEY`: 启用主题到概念映射的智谱 Web Search
- `IFIND_USERNAME` / `IFIND_PASSWORD`: 启用 iFinD 作为主筛选数据源
- `REFCHECKER_*`: 启用 RefChecker 可信度分析

说明：

- `REFCHECKER_ENABLED=false` 时，`python-service` 镜像默认只安装基础依赖，可信度分析接口会继续使用内置 heuristic fallback。
- 如果要启用 RefChecker，请先在 `deploy/.env` 中将 `REFCHECKER_ENABLED=true`，再执行 `docker compose ... up -d --build` 重新构建镜像。

## 2. 可选的 iFinD 厂商包

公共 PyPI 当前没有可直接安装的 `iFinDPy` 发行版。如果需要在 Linux 容器内启用 iFinD，请将厂商提供的安装包放到：

```text
deploy/python/vendor/
```

支持格式：

- `*.whl`
- `*.tar.gz`
- `*.zip`

如果该目录为空，Python 服务仍可构建，并按 `SCREENING_ENABLE_AKSHARE_FALLBACK` 退回到 AkShare。

## 3. 主题规则持久化

主题概念规则默认持久化到 Docker 命名卷 `python_theme_rules_data`，默认路径：

```text
/data/theme-concept-rules/theme_concept_rules.json
```

如有需要，可通过 `INTELLIGENCE_THEME_CONCEPT_RULES_FILE` 覆盖。

## 4. THS 概念目录文件

概念目录主链路现在使用本地 THS 快照文件，而不是在请求时直接调用 `stock_board_concept_name_ths`。

- 容器内默认路径：`/app/data/ths_concept_catalog.csv`
- 宿主机路径：仓库根目录下的 [ths_concept_catalog.csv](D:/课外项目/stock-screening-boost/data/ths_concept_catalog.csv)
- `python-service` 会将仓库根 `data/` 目录绑定挂载到容器内 `/app/data`

可以通过 `INTELLIGENCE_CONCEPT_CATALOG_FILE` 覆盖默认路径。

### 刷新命令

建议至少每日盘前或盘后刷新一次：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml run --rm python-service python scripts/refresh_concept_catalog.py --output /app/data/ths_concept_catalog.csv
```

如果你是在本地 Python 环境中执行，也可以在 `python_services/` 目录下运行：

```bash
python scripts/refresh_concept_catalog.py --output ../data/ths_concept_catalog.csv
```

### 运维注意事项

- 刷新脚本会从 THS 拉取最新概念目录，并覆盖写入 `ths_concept_catalog.csv`
- 如果概念目录文件缺失、为空或列结构损坏，概念相关接口会显式报错，不会自动回退到 live THS
- 更新本地 `data/ths_concept_catalog.csv` 后，无需重建镜像；后续请求会按文件更新时间自动热加载

## 5. 启动服务

在仓库根目录执行：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

启动后：

- `web` 会依次执行 `npm run validate:runtime`、`npm run db:push`、`npm run start`
- `workflow-worker` 会轮询并执行工作流任务
- `screening-worker` 会轮询并执行筛选任务

## 6. 访问地址

- Web: `http://localhost:3000`
- Python API Docs: `http://localhost:8000/docs`
- PostgreSQL: 默认 `localhost:5432`

## 7. 常用命令

查看全部日志：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f
```

查看 workflow worker 日志：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f workflow-worker
```

查看容器状态：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

停止服务：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
```

停止服务并删除数据卷：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down -v
```

# 股票投研工作流定制化平台

基于 T3 Stack 构建的智能股票筛选平台，通过 DDD 架构和 AI 工作流编排快速排除市场噪音，聚焦高价值投资标的。

## 技术栈

### 前端与后端（T3 Stack）
- **Next.js 15+** - App Router 模式
- **TypeScript** - 严格类型检查
- **tRPC** - 端到端类型安全 API
- **Prisma** - 数据库 ORM
- **NextAuth.js** - 身份认证
- **Tailwind CSS** - 样式框架
- **Biome** - 代码质量工具（Linting + Formatting）

### 数据服务（Python 微服务）
- **FastAPI** - 高性能 Web 框架
- **AkShare** - 金融数据获取
- **Uvicorn** - ASGI 服务器

### 测试
- **Vitest** - 单元测试与集成测试
- **fast-check** - 基于属性的测试（Property-based Testing）
- **pytest** - Python 服务测试

## 架构设计

### DDD 分层架构

项目采用领域驱动设计（DDD），按限界上下文组织代码：

```
src/server/
├── domain/              # 领域层
│   └── screening/       # 股票筛选限界上下文
│       ├── aggregates/  # 聚合根（ScreeningStrategy, ScreeningSession, WatchList）
│       ├── entities/    # 实体（FilterGroup, Stock）
│       ├── value-objects/ # 值对象（StockCode, FilterCondition, ScoringConfig）
│       ├── services/    # 领域服务（IndicatorCalculationService, ScoringService）
│       ├── repositories/ # 仓储接口
│       └── enums/       # 枚举类型
├── infrastructure/      # 基础设施层
│   └── screening/       # 仓储实现、外部服务客户端
└── api/                 # 应用层（tRPC Routers）
    └── routers/         # API 路由
```

### 混合架构

- **T3 Stack (Next.js)**: 负责用户界面、业务逻辑编排、数据持久化
- **Python FastAPI**: 专门提供金融数据接口（AkShare）
- 两者为独立的运行时和部署单元，通过 HTTP API 通信

## 快速开始

### 前置要求

- Node.js 18+
- Python 3.9+
- PostgreSQL（或其他 Prisma 支持的数据库）

### 安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
cd python_services
pip install -r requirements.txt
cd ..
```

### 环境配置

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

配置数据库连接和认证密钥：

```env
DATABASE_URL="postgresql://user:password@localhost:5432/stock_screening"
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"
```

### 数据库迁移

```bash
npm run db:push
```

### 启动服务

1. 启动 Python 数据服务：

```bash
cd python_services
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

2. 启动 Next.js 开发服务器：

```bash
npm run dev
```

访问 http://localhost:3000

## 可用脚本

### 开发
- `npm run dev` - 启动开发服务器（Turbo 模式）
- `npm run preview` - 构建并预览生产版本

### 代码质量
- `npm run check` - 运行 Biome 检查
- `npm run check:write` - 自动修复代码问题
- `npm run typecheck` - TypeScript 类型检查

### 测试
- `npm test` - 运行所有测试
- `npm run test:watch` - 监听模式运行测试
- `npm run test:coverage` - 生成测试覆盖率报告

### 数据库
- `npm run db:push` - 推送 schema 到数据库
- `npm run db:studio` - 打开 Prisma Studio
- `npm run db:generate` - 生成 Prisma Client
- `npm run db:migrate` - 运行数据库迁移

## 项目特性

### 核心功能

- **智能筛选策略**: 基于技术指标和基本面的多维度筛选
- **评分系统**: 可配置的股票评分机制
- **自选股管理**: 支持分组和备注的自选股列表
- **筛选会话**: 保存和复用筛选结果
- **历史数据分析**: 基于历史数据的指标计算

### 技术亮点

- **端到端类型安全**: tRPC 确保前后端类型一致
- **领域驱动设计**: 清晰的业务逻辑边界
- **测试驱动开发**: 单元测试 + 属性测试覆盖
- **微服务架构**: Python 数据服务独立部署
- **代码质量保障**: Biome + TypeScript 严格模式

## 文档

- [需求分析与概要设计](./docs/股票投研工作流定制化平台%20-%20需求分析与概要设计文档.md)
- [领域层设计文档](./docs/Stock%20Screening%20Context%20-%20领域层设计文档.md)
- [Python 数据服务](./python_services/README.md)

## 开发规范

详见 [AGENTS.md](./AGENTS.md)，包括：
- 技术栈约束
- 架构原则
- Git 提交规范
- 代码风格指南

## License

MIT

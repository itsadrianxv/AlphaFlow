# Agent 行为规范


## 项目背景
本项目是**股票投研工作流定制化平台**，采用 T3 Stack（Next.js App Router + TypeScript + tRPC + Prisma + Tailwind CSS），核心目标是通过 LangGraph 编排的智能工作流快速排除市场噪音，聚焦高价值投资标的。

## 技术栈约束

### 必须遵守的技术选型
- **前端框架**: Next.js 15+ (App Router 模式，禁用 Pages Router)
- **语言**: TypeScript (严格模式，禁用 `any` 类型除非有明确注释说明)
- **API 层**: tRPC (端到端类型安全)
- **数据库**: Prisma ORM
- **样式**: Tailwind CSS
- **认证**: NextAuth.js
- **代码质量**: Biome (Linting + Formatting)
- **路径别名**: `~/` (例如 `import { User } from "~/server/db/schema"`)

### 架构原则
1. **DDD 分层架构** (Domain-Driven Design)
   - 应用应当在横向上划分为不同的限界上下文；纵向上划分出应用层、领域层、基础设施层（没有接口层，因为采用了tRPC）
   - 领域层内包括聚合根、实体、值对象、领域服务、领域事件，领域服务保持无状态
   - 应用层保持无状态

2. **T3 Stack (TypeScript) + Python FastAPI 微服务** 混合架构：
   - **T3 Stack (Next.js)**：负责用户界面、业务逻辑编排、数据持久化，代码位于 `src/` 目录
   - **Python FastAPI 服务**：专门提供金融数据接口（AkShare），代码位于 `python_services/` 目录
   - 两者为独立的运行时和部署单元，通过 HTTP API 通信
   - T3 侧通过基础设施层的 HTTP client 调用 FastAPI 服务，领域层不直接依赖外部服务（通过接口反转）

3. **目录结构约定**
   - `src/server/domain/` — 按限界上下文组织领域代码（如 `screening/`、`workflow/`）
   - `src/server/infrastructure/` — 基础设施层（仓储实现、外部服务客户端等）
   - `src/server/api/routers/` — tRPC routers 充当应用层入口，编排领域服务调用，本身不含业务逻辑
   - `python_services/` — Python 微服务，独立的工具链（pyproject.toml）、独立测试、独立部署

4. **LangGraph 工作流编排**
   - 所有 AI Agent 工作流使用 LangGraph.js 定义
   - 工作流配置存储在数据库，支持用户自定义

## 自动 Git 提交规则

当你完成以下任何一类操作后，必须自动执行 `git add -A`、`git commit -m "<message>"`、`git push`：

1. 修复 bug 或错误（如导入路径修复、运行时报错修复）
2. 新增功能或文件
3. 重构代码（如重命名、移动文件、调整结构）
4. 修改配置文件（如 Dockerfile、pytest.ini、requirements.txt 等）
5. 更新或新增测试
6. 更新文档（如 README、需求文档、AGENTS.md 等）

## Commit 消息格式

使用中文，遵循 Conventional Commits 风格：

```
<type>: <简要描述>

<可选的详细说明>
```

type 取值：
- `fix`: 修复 bug
- `feat`: 新功能
- `refactor`: 重构
- `docs`: 文档变更
- `chore`: 构建/配置/工具变更
- `test`: 测试相关
- `style`: 格式调整（不影响逻辑）

## 注意事项

- 每次操作完成后立即提交，不要积攒多个不相关的变更到一个 commit
- commit 消息要准确描述本次变更内容
- 如果一次用户请求涉及多个不相关的改动，拆分为多个 commit

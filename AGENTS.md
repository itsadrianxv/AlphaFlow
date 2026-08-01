# AGENTS

## 中文编码
- 所有文件读写、脚本生成、批量替换和自动编辑都必须显式使用 **UTF-8**
- 禁止使用系统默认编码、GBK/GB2312/CP936 或会导致中文 mojibake 的工具链保存文件

## test code
- test code within web/ should be placed in web/tests, not dotted around the entire web/ directory

## TuShare 接口说明
- TuShare 拥有 15000 积分

## 页面设计
- 禁止给页面加 eyebrow

## 本机端口
- 3000 端口必须留给本项目的 web 容器

## 不要进行浏览器验证
- 本项目代码不要进行浏览器验证

## 本项目尚未部署
- 本项目处于全面开发时期，尚未部署
- 因此没有任何用户数据，数据库当中的所有数据都是 mock 的测试数据
- 因此在需要升级数据库 schema，涉及到 migration 的时候，直接毫不犹豫把旧数据删掉，只管写新逻辑，不用写任何兜底/兼容逻辑

## 部署到 ECS 服务器
- 本项目部署到阿里云 ECS 服务器，但是仍未开放给广大用户使用
- 部署到 ECS 服务器的脚本位于 temp\阿里云服务器\deploy-to-ecs.ps1

## Agent skills

### Issue tracker

项目规格与问题使用 GitHub Issues 管理。详见 `docs/agents/issue-tracker.md`。

### Triage labels

项目使用默认的五类 triage 标签词汇。详见 `docs/agents/triage-labels.md`。

### Domain docs

项目采用单一上下文：根目录 `CONTEXT.md` 与 `docs/adr/`。详见 `docs/agents/domain.md`。

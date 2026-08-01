# Issue tracker：GitHub

本仓库的 issue 与规格使用 GitHub Issues 管理，所有操作使用 `gh` CLI，并从当前仓库的 Git remote 自动确定目标仓库。

## 约定

- 创建 issue：`gh issue create --title "..." --body-file <path>`。
- 读取 issue：`gh issue view <number> --comments`，同时读取标签。
- 列出 issue：`gh issue list --state open --json number,title,body,labels,comments`，并按任务要求筛选标签和状态。
- 评论 issue：`gh issue comment <number> --body "..."`。
- 添加或删除标签：`gh issue edit <number> --add-label "..."` 或 `--remove-label "..."`。
- 关闭 issue：`gh issue close <number> --comment "..."`。

## Pull request

Pull request 不作为 triage 请求入口。

## 技能发布语义

当技能要求“发布到 issue tracker”时，创建 GitHub issue；当技能要求“读取相关 ticket”时，使用 `gh issue view <number> --comments`。

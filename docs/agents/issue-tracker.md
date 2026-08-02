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

## Wayfinding operations

Wayfinder 地图的父子关系、依赖关系、子议题排序和前沿查询统一通过 `scripts/wayfinder-tracker.ps1` 管理。该脚本是这些 tracker 结构操作的唯一规范接口；业务流程禁止直接拼接相应的 `gh api` 命令，也无需处理仓库名、issue 的 REST 数据库 ID 或 GraphQL node ID。

```powershell
pwsh scripts/wayfinder-tracker.ps1 inspect  -Map <number>
pwsh scripts/wayfinder-tracker.ps1 frontier -Map <number>
pwsh scripts/wayfinder-tracker.ps1 attach   -Map <number> -Ticket <number>
pwsh scripts/wayfinder-tracker.ps1 detach   -Map <number> -Ticket <number>
pwsh scripts/wayfinder-tracker.ps1 block    -Ticket <number> -By <number>
pwsh scripts/wayfinder-tracker.ps1 unblock  -Ticket <number> -By <number>
pwsh scripts/wayfinder-tracker.ps1 reorder  -Map <number> -Ticket <number> -After <number>
```

调用者只传 GitHub issue 编号。`frontier` 按地图中的子议题顺序返回开放、未认领且没有开放 blocker 的票据，其中 `default` 是默认前沿票；所有操作输出 JSON，失败时返回非零退出码。写操作可安全重试：目标结构已经存在或已经移除时返回 `changed: false`。

创建、读取、认领、评论、关闭、标签管理，以及通过 `--body-file` 更新地图正文，仍使用普通 `gh issue` 命令。该脚本只管理 tracker 结构；Wayfinder 技能负责领域决策和地图正文语义。

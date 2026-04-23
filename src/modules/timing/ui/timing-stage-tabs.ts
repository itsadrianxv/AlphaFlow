import type { WorkflowStageTab } from "~/shared/ui/navigation/workflow-stage-config";

export const timingStageTabs: WorkflowStageTab[] = [
  {
    id: "source",
    label: "选择来源",
    summary: "先决定这轮判断从单股还是自选股列表启动。",
  },
  {
    id: "portfolio",
    label: "盘点组合",
    summary: "录入现金、持仓和风控边界，判断还有多少操作空间。",
  },
  {
    id: "strategy",
    label: "策略风格",
    summary: "先选稳健、均衡或进攻，再按需要展开高级设置。",
  },
  {
    id: "results",
    label: "查看建议",
    summary: "确认当前约束与策略，生成本轮建议并查看复盘结果。",
  },
];

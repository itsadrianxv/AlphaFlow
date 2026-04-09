import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export const screeningStageTabs: WorkflowStageTab[] = [
  {
    id: "stocks",
    label: "选股池",
    summary: "先锁定本轮筛选的股票范围。",
  },
  {
    id: "indicators",
    label: "指标-公式",
    summary: "挑出要观察的指标和派生公式。",
  },
  {
    id: "period",
    label: "期间设置",
    summary: "限定财报周期与取数范围。",
  },
  {
    id: "filters",
    label: "本地筛选",
    summary: "对已取回的数据做排序和过滤。",
  },
  {
    id: "results",
    label: "结果表",
    summary: "查看输出、保存工作台并继续研究。",
  },
];

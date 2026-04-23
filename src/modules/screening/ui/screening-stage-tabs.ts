import type { WorkflowStageTab } from "~/shared/ui/navigation/workflow-stage-config";

export const screeningStageTabs: WorkflowStageTab[] = [
  {
    id: "stocks",
    label: "选股池",
    summary: "先锁定本轮筛选覆盖的股票范围。",
  },
  {
    id: "indicators",
    label: "指标-公式",
    summary: "挑出要观察的官方指标和自定义公式。",
  },
  {
    id: "period",
    label: "期间设置",
    summary: "限定报告周期与取数范围。",
  },
  {
    id: "results",
    label: "结果表",
    summary: "边看结果边筛选、排序，并决定是否保存工作台。",
  },
];

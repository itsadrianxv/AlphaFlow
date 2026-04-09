import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export const timingStageTabs: WorkflowStageTab[] = [
  {
    id: "signals",
    label: "信号来源",
    summary: "先决定是单股、自选股还是筛选联动。",
  },
  {
    id: "portfolio",
    label: "组合约束",
    summary: "明确现金、仓位和风险预算边界。",
  },
  {
    id: "preset",
    label: "预设策略",
    summary: "确定择时评分和复盘策略配置。",
  },
  {
    id: "recommendations",
    label: "组合建议",
    summary: "查看动作、区间和市场约束。",
  },
  {
    id: "reviews",
    label: "复盘记录",
    summary: "回看执行后的结果并校正策略。",
  },
];

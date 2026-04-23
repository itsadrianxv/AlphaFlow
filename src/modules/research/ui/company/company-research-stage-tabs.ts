import type { WorkflowStageTab } from "~/shared/ui/navigation/workflow-stage-config";

export const companyResearchStageTabs: WorkflowStageTab[] = [
  {
    id: "target",
    label: "研究目标",
    summary: "定义公司、股票代码和核心判断问题。",
  },
  {
    id: "sources",
    label: "证据来源",
    summary: "补充官网、概念线索和附加链接。",
  },
  {
    id: "launch",
    label: "发起执行",
    summary: "锁定输入并生成本轮公司判断。",
  },
];

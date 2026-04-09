import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export const workflowsStageTabs: WorkflowStageTab[] = [
  {
    id: "question",
    label: "研究问题",
    summary: "先把问题写成可验证的投资判断。",
  },
  {
    id: "constraints",
    label: "研究约束",
    summary: "限定信源、必答问题与时效窗口。",
  },
  {
    id: "launch",
    label: "发起执行",
    summary: "确认输入后发起本轮研究。",
  },
  {
    id: "queue",
    label: "最近结论",
    summary: "按队列查看最新运行与结论摘要。",
  },
];

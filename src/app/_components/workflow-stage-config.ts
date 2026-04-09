export type PrimaryWorkflowStage = {
  id: "screening" | "workflows" | "companyResearch" | "timing";
  href: string;
  label: string;
  summary: string;
};

export type WorkflowStageTab = {
  id: string;
  label: string;
  summary: string;
};

export const primaryWorkflowStages: PrimaryWorkflowStage[] = [
  {
    id: "screening",
    href: "/screening",
    label: "筛选",
    summary: "压缩噪音，只保留值得继续研究的标的。",
  },
  {
    id: "workflows",
    href: "/workflows",
    label: "行业研究",
    summary: "先确认行业逻辑、兑现节奏与证据边界。",
  },
  {
    id: "companyResearch",
    href: "/company-research",
    label: "公司判断",
    summary: "把公司质地、概念兑现与证据链放到同一结论里。",
  },
  {
    id: "timing",
    href: "/timing",
    label: "择时组合",
    summary: "把动作、仓位、风险预算和复盘闭环落地。",
  },
];

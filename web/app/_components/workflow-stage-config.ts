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
    summary: "",
  },
  {
    id: "workflows",
    href: "/workflows",
    label: "行业研究",
    summary: "",
  },
  {
    id: "companyResearch",
    href: "/company-research",
    label: "公司判断",
    summary: "",
  },
  {
    id: "timing",
    href: "/timing",
    label: "择时组合",
    summary: "",
  },
];

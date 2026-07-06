import { Suspense } from "react";
import { WorkflowHistoryClient } from "~/app/_components/workflow-history-client";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

export default function CompanyResearchHistoryPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowHistoryClient
        section="companyResearch"
        eyebrow="公司判断历史"
        title="公司判断历史"
        description="集中查看历次公司研究记录，支持按公司名、关键问题和异常信息快速回溯。"
        emptyTitle="还没有公司判断记录"
        searchPlaceholder="搜索公司名、关键问题、节点或报错"
        moduleHref="/company-research"
        moduleLabel="返回公司判断"
        templateCode={COMPANY_RESEARCH_TEMPLATE_CODE}
      />
    </Suspense>
  );
}

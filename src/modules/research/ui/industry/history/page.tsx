import { Suspense } from "react";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/modules/research/server/domain/workflow/types";
import { WorkflowHistoryClient } from "~/modules/research/ui/workflow-history-client";

export default function WorkflowsHistoryPage() {
  return (
    <Suspense fallback={null}>
      <WorkflowHistoryClient
        section="workflows"
        eyebrow="行业判断历史"
        title="行业判断历史"
        description="把历次行业主题研究集中到同一页面浏览，便于回看问题表述、研究结论和仍在执行中的任务。"
        emptyTitle="还没有行业判断记录"
        searchPlaceholder="搜索主题、问题、节点或报错"
        moduleHref="/research"
        moduleLabel="返回行业判断"
        templateCode={QUICK_RESEARCH_TEMPLATE_CODE}
      />
    </Suspense>
  );
}

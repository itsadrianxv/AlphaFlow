import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CompanyResearchDetail layout", () => {
  const detailSource = readFileSync(
    "app/workflows/company-research-detail.tsx",
    "utf8",
  );
  const runClientSource = readFileSync(
    "app/workflows/[runId]/run-investor-client.tsx",
    "utf8",
  );
  const agentStepSource = readFileSync(
    "app/workflows/workflow-agent-step.tsx",
    "utf8",
  );
  const researchOpsSource = readFileSync(
    "app/workflows/research-ops-panels.tsx",
    "utf8",
  );
  const companyPageSource = readFileSync(
    "app/company-research/[runId]/page.tsx",
    "utf8",
  );

  it("removes explanatory copy from the company conclusion experience", () => {
    const combined = [
      detailSource,
      runClientSource,
      agentStepSource,
      researchOpsSource,
    ].join("\n");

    expect(combined).not.toContain(
      "把核心投资结论、证据摘要、风险、下一步动作和可信度分析放在同一页查看。",
    );
    expect(combined).not.toContain(
      "先看 Agent 状态图、运行摘要和研究执行状态。",
    );
    expect(combined).not.toContain("先看立场、理由、风险和下一步动作。");
    expect(combined).not.toContain("聚焦业务契合点、概念兑现和变现路径。");
    expect(combined).not.toContain("按研究问题查看答案、置信度和证据预览。");
    expect(combined).not.toContain("审查证据覆盖、来源类型和引用内容。");
    expect(combined).not.toContain("先看本次公司研究用了多少证据，再下钻到具体引用。");
    expect(combined).not.toContain("按来源类型或信源层级切换引用列表。");
    expect(combined).not.toContain("展示提取事实、原文片段和来源链接。");
    expect(combined).not.toContain("保留摘要层，不在主详情页展开逐条断言审核。");
    expect(combined).not.toContain(
      "显示当前 workflow 的 Agent 拓扑、执行进度和已走过的路径。",
    );
    expect(combined).not.toContain("保留详情页内的通用运行状态摘要。");
    expect(combined).not.toContain(
      "按依赖深度展示研究单元、角色分工、交付物和回退能力。",
    );
    expect(combined).not.toContain(
      "软门禁评审结果会保留合同得分、覆盖率和修复建议，但不阻塞最终交付。",
    );
  });

  it("puts investment point lists before summary panels", () => {
    expect(detailSource.indexOf('title="看多逻辑"')).toBeLessThan(
      detailSource.indexOf('title="结论摘要"'),
    );
    expect(detailSource.indexOf('title="风险点"')).toBeLessThan(
      detailSource.indexOf('title="结论摘要"'),
    );
    expect(detailSource.indexOf('title="下一步动作"')).toBeLessThan(
      detailSource.indexOf('title="结论摘要"'),
    );
    expect(detailSource.indexOf('title="结论摘要"')).toBeLessThan(
      detailSource.indexOf('title="可信度摘要"'),
    );
  });

  it("hides company-only summary metrics and agent ops sections", () => {
    expect(runClientSource).toContain(
      "showIndustryConclusion || showCompanyShell ? undefined",
    );
    expect(detailSource).toContain(
      'metrics: digest.metrics.filter((item) => item.label !== "合同得分")',
    );
    expect(detailSource).toContain("showResearchPlan={false}");
    expect(detailSource).toContain("showReflection={false}");
    expect(agentStepSource).toContain("showResearchPlan = true");
    expect(agentStepSource).toContain("showReflection = true");
    expect(researchOpsSource).toContain("showResearchPlan && plan.length > 0");
    expect(researchOpsSource).toContain("showReflection && reflection");
  });

  it("keeps question reference preview collapsed by default", () => {
    expect(detailSource).toContain(
      "const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(",
    );
    expect(detailSource).toContain("null,\n  );");
    expect(detailSource).toContain("return null;");
  });

  it("passes the company template while the company page is loading", () => {
    expect(companyPageSource).toContain("COMPANY_RESEARCH_TEMPLATE_CODE");
    expect(companyPageSource).toContain("initialTemplateCode");
  });

  it("exposes a standalone full research report tab with an empty state", () => {
    expect(detailSource).toContain('id: "report"');
    expect(detailSource).toContain('label: "研究正文"');
    expect(detailSource).toContain("fullReportMarkdown: result.fullReportMarkdown");
    expect(detailSource).toContain("暂无研究正文");
    expect(detailSource).toContain("<MarkdownContent content={props.model.fullReportMarkdown} />");
  });
});

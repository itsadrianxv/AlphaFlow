import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("择时专业双工作区", () => {
  const consoleSource = readFileSync(
    "app/timing/timing-run-console.tsx",
    "utf8",
  );
  const editorSource = readFileSync(
    "app/timing/strategies/timing-strategy-editor.tsx",
    "utf8",
  );
  const reportSource = readFileSync(
    "app/timing/reports/[cardId]/timing-report-view.tsx",
    "utf8",
  );

  it("运行台引用已发布修订并执行真实数据预检", () => {
    expect(consoleSource).toContain("getTimingRunPreflight");
    expect(consoleSource).toContain("LATEST_COMPLETE");
    expect(consoleSource).toContain("CURRENT_PARTIAL");
    expect(consoleSource).toContain("preflight.data?.canRun");
    expect(consoleSource).toContain("missingPrimary");
    expect(consoleSource).toContain("unresolvedVetos");
  });

  it("策略编辑器包含五个专业视图与不可变修订操作", () => {
    for (const label of [
      "交易意图",
      "周期结构",
      "规则配置",
      "风控复盘",
      "回放发布",
    ]) {
      expect(editorSource).toContain(label);
    }
    expect(editorSource).toContain("cloneTimingStrategyRevision");
    expect(editorSource).toContain("runTimingBacktest");
    expect(editorSource).toContain("publishTimingStrategyRevision");
    expect(editorSource).toContain('selectedRevision?.status === "DRAFT"');
  });

  it("规则配置允许周期、阈值、连续确认、必选和否决级别覆盖", () => {
    expect(editorSource).toContain("confirmationBars");
    expect(editorSource).toContain("vetoSeverity");
    expect(editorSource).toContain("minSatisfied");
    expect(editorSource).toContain("rule.timeframe");
    expect(editorSource).toContain("reviewTradingDays");
  });

  it("报告只展示确定性审计，不展示综合分和置信度", () => {
    expect(reportSource).toContain("确定性规则审计");
    expect(reportSource).toContain("冻结数据清单");
    expect(reportSource).toContain("potentialAction");
    expect(reportSource).toContain("finalAction");
    expect(reportSource).not.toContain("综合择时评分");
    expect(reportSource).not.toContain("六大择时模型");
  });

  it("桌面表格在窄屏保持横向滚动且表单可换列", () => {
    expect(consoleSource).toContain("overflow-x-auto");
    expect(consoleSource).toContain("md:grid-cols-2");
    expect(editorSource).toContain("overflow-x-auto");
    expect(editorSource).toContain("xl:grid-cols-[260px_minmax(0,1fr)]");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("择时研究工作台", () => {
  const consoleSource = readFileSync("app/timing/timing-run-console.tsx", "utf8");
  const editorSource = readFileSync("app/timing/strategies/timing-strategy-editor.tsx", "utf8");
  const reportSource = readFileSync("app/timing/reports/[cardId]/timing-report-view.tsx", "utf8");
  const historySource = readFileSync("app/timing/history/timing-history-client.tsx", "utf8");

  it("运行台只接受研究对象和相对权重组合", () => {
    expect(consoleSource).toContain("个股研究");
    expect(consoleSource).toContain("组合诊断");
    expect(consoleSource).toContain("归一化权重");
    expect(consoleSource).toContain("startResearchRun");
  });

  it("报告提供五个研究页签和独立环境解释", () => {
    for (const label of ["研究概览", "技术结构", "市场环境", "模型预测", "数据证据"]) {
      expect(reportSource).toContain(label);
    }
    expect(reportSource).toContain("不参与个股研究状态判定");
    expect(reportSource).toContain("不参与综合分数或研究状态");
  });

  it("规则编辑器使用校验发布且历史页仅展示研究档案", () => {
    expect(editorSource).toContain("校验发布");
    expect(editorSource).toContain("validateResearchRuleRevision");
    expect(editorSource).toContain("publishResearchRuleRevision");
    expect(historySource).toContain("研究档案");
  });

  it("研究界面不包含交易执行输出", () => {
    const source = [consoleSource, editorSource, reportSource, historySource].join("\n");
    for (const forbidden of ["买入", "卖出", "加仓", "减仓", "持有", "允许执行", "仓位建议", "止损价", "订单计划", "胜率", "预期收益"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

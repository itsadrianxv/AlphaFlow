import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IndustryConclusionDetail,
  type IndustryConclusionViewModel,
} from "~/app/workflows/[runId]/industry-conclusion-detail";

const model: IndustryConclusionViewModel = {
  query: "AI infra",
  generatedAtLabel: "2026/04/14 09:10",
  headline: "AI 基建进入兑现窗口，优先跟进龙头链条。",
  summary: "先看**结论**，再按板块展开证据和风险。",
  verdictLabel: "高热度赛道",
  verdictTone: "success",
  activeSectionId: "overview",
  statusLabel: "已完成",
  modePills: ["深度模式"],
  metricStrip: [
    { label: "可信度", value: "86" },
    { label: "赛道热度", value: "82%" },
    { label: "候选标的", value: "6" },
    { label: "重点标的", value: "2" },
  ],
  overviewPoints: [
    "行业景气和产业事件正在形成共振。",
    "更适合继续聚焦龙头，而不是均匀铺开。",
  ],
  overviewActions: [
    {
      label: "继续看 中际旭创",
      href: "/company-research?companyName=%E4%B8%AD%E9%99%85%E6%97%AD%E5%88%9B",
      variant: "primary",
    },
    { label: "加入研究空间", href: "/spaces?addRunId=run_quick_1" },
  ],
  notices: [
    {
      title: "择时报告入口",
      description: "若需要查看价格结构图，可进入对应报告。",
      tone: "info",
      actions: [{ label: "查看单股报告", href: "/timing/reports/card_1" }],
    },
  ],
  sections: [
    {
      id: "overview",
      label: "总览",
      summary: "结论、摘要、动作",
    },
    {
      id: "logic",
      label: "核心逻辑",
      summary: "行业驱动与重点标的",
    },
    {
      id: "evidence",
      label: "证据与可信度",
      summary: "支持/不足/冲突",
    },
    {
      id: "risks",
      label: "风险与下一步",
      summary: "缺口、反例和动作",
    },
  ],
  logic: {
    industryDrivers: ["订单和扩产节奏同步强化"],
    competitionSummary: "竞争格局仍向头部集中。",
    topPicks: [
      {
        stockCode: "300308",
        stockName: "中际旭创",
        reason: "800G 放量延续。",
        href: "/company-research?companyName=%E4%B8%AD%E9%99%85%E6%97%AD%E5%88%9B",
      },
    ],
  },
  evidence: {
    scoreLabel: "86",
    levelLabel: "高",
    coverageLabel: "88%",
    tripletLabel: "1/1/0",
    notes: ["一手信源覆盖偏少。"],
    qualityFlags: ["first_party_low"],
    missingRequirements: ["citation_coverage_below_target"],
    claims: [
      {
        claimId: "claim_1",
        claimText: "龙头订单兑现更快。",
        label: "supported",
        explanation: "公告和新闻交叉验证了**订单节奏**。",
      },
    ],
    researchPlan: [
      {
        id: "unit_theme",
        title: "产业链景气跟踪",
        capability: "theme_overview",
        status: "completed",
      },
    ],
  },
  risks: {
    summary: "仍需补财报和公告交叉验证。",
    missingAreas: ["财报披露滞后"],
    riskSignals: ["估值和利润兑现仍需继续对表"],
    unansweredQuestions: ["利润兑现是否足以支撑当前估值"],
    nextActions: ["补充公告与财报验证", "转入公司判断：中际旭创"],
  },
};

describe("IndustryConclusionDetail", () => {
  it("renders the overview section by default", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, { model }),
    );

    expect(markup).toContain('data-industry-conclusion-detail="true"');
    expect(markup).toContain('data-active-section="overview"');
    expect(markup).toContain("AI 基建进入兑现窗口，优先跟进龙头链条。");
    expect(markup).toMatch(/<strong[^>]*>结论<\/strong>/);
    expect(markup).toContain("查看单股报告");
    expect(markup).toContain("加入研究空间");
    expect(markup).toContain("行业景气和产业事件正在形成共振。");
    expect(markup).not.toContain("公告和新闻交叉验证了订单节奏。");
    expect(markup).not.toContain("财报披露滞后");
  });

  it("renders only the requested section body when initialSectionId changes", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, {
        model,
        initialSectionId: "evidence",
      }),
    );

    expect(markup).toContain('data-active-section="evidence"');
    expect(markup).toMatch(/<strong[^>]*>订单节奏<\/strong>/);
    expect(markup).toContain("已支持");
    expect(markup).toContain("引用覆盖未达到目标");
    expect(markup).toContain("一手信源覆盖不足");
    expect(markup).not.toContain("行业景气和产业事件正在形成共振。");
    expect(markup).not.toContain("财报披露滞后");
  });
});

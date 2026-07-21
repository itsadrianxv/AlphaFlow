import { describe, expect, it } from "vitest";
import {
  attachWorkflowNodeInsight,
  parseWorkflowNodeInsight,
} from "~/contracts/workflow-node-insight";

describe("workflow node insight", () => {
  it("保留 Agent 决定的任意字段名称和顺序", () => {
    const result = parseWorkflowNodeInsight({
      fields: [
        { label: "当前分歧", value: { kind: "text", text: "需求强度仍待验证" } },
        { label: "后续问题", value: { kind: "list", items: ["订单能见度", "库存周期"] } },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fields.map((field) => field.label)).toEqual([
        "当前分歧",
        "后续问题",
      ]);
    }
  });

  it("仅保留节点输出中可验证的引用", () => {
    const output = attachWorkflowNodeInsight({
      references: [
        {
          id: "ref-1",
          title: "公司公告",
          url: "https://example.com/notice",
        },
      ],
      insight: {
        fields: [
          {
            label: "关键依据",
            value: { kind: "text", text: "公告披露了新的经营指引。" },
            citations: [
              { referenceId: "ref-1", label: "错误标签", url: "https://invalid.test" },
              { referenceId: "missing", label: "不存在" },
            ],
          },
        ],
      },
    });

    const insight = parseWorkflowNodeInsight(output.insight);
    expect(insight.success).toBe(true);
    if (insight.success) {
      expect(insight.data.fields[0]?.citations).toEqual([
        {
          referenceId: "ref-1",
          label: "公司公告",
          url: "https://example.com/notice",
        },
      ]);
    }
  });

  it("在节点没有提供 insight 时从真实输出生成展示回退", () => {
    const output = attachWorkflowNodeInsight({
      candidateCount: 3,
      qualityFlags: ["来源时效有限"],
    });

    const insight = parseWorkflowNodeInsight(output.insight);
    expect(insight.success).toBe(true);
    if (insight.success) {
      expect(insight.data.fields.map((field) => field.label)).toEqual([
        "候选标的数量",
        "质量提示",
      ]);
    }
  });
});

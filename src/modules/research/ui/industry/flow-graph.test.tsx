/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in this test. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlowGraph } from "~/modules/research/ui/industry/flow-graph";

describe("FlowGraph", () => {
  it("renders stage groups, node states, and path pills", () => {
    const markup = renderToStaticMarkup(
      <FlowGraph
        mode="user"
        graph={{
          stages: [
            { key: "scope", name: "范围澄清" },
            { key: "report", name: "结果输出" },
          ],
          nodes: [
            {
              key: "clarify",
              name: "澄清需求",
              kind: "agent",
              goal: "澄清研究目标与输入范围",
              stage: "scope",
              state: "done",
              result: null,
              note: "范围已锁定",
              stats: { ready: true },
            },
            {
              key: "report",
              name: "生成报告",
              kind: "agent",
              goal: "生成最终研究结论",
              stage: "report",
              state: "active",
              result: null,
              note: "正在生成",
              stats: { draft: 1 },
            },
          ],
          edges: [{ from: "clarify", to: "report", when: "ok" }],
          activePath: ["clarify", "report"],
          current: null,
        }}
      />,
    );

    expect(markup).toContain("范围澄清");
    expect(markup).toContain("结果输出");
    expect(markup).toContain("范围已锁定");
    expect(markup).toContain("进行中");
    expect(markup).toContain("路径");
    expect(markup).toContain("clarify → report");
  });
});

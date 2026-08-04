import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResearchNoteMindMapLinks } from "~/app/research-targets/research-note-mind-map-links";

vi.stubGlobal("React", React);

const linkedMindMaps = [
  {
    id: "mind-map-1",
    title: "需求与技术路线",
    description: "跟踪需求、技术和产能",
    nodeId: "node-1",
    relationType: "research_note",
  },
  {
    id: "mind-map-2",
    title: "证据核验",
    description: null,
    nodeId: null,
    relationType: "evidence",
  },
];

describe("投研笔记关联导图入口", () => {
  it("渲染一条笔记关联的全部思维导图入口", () => {
    const html = renderToStaticMarkup(
      React.createElement(ResearchNoteMindMapLinks, { linkedMindMaps }),
    );

    expect(html).toContain("关联思维导图");
    expect(html).toContain('href="/mind-maps/mind-map-1"');
    expect(html).toContain('href="/mind-maps/mind-map-2"');
    expect(html).toContain("需求与技术路线");
    expect(html).toContain("证据核验");
  });

  it("笔记没有关联导图时不渲染空区域", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(ResearchNoteMindMapLinks, { linkedMindMaps: [] }),
      ),
    ).toBe("");
  });
});

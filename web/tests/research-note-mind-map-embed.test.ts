import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));

vi.mock("~/trpc/react", () => ({
  api: { mindMap: { get: { useQuery } } },
}));

import { EmbeddedMindMapViewer } from "~/app/research-targets/research-note-mind-map-links";

vi.stubGlobal("React", React);

const mindMap = {
  id: "mind-map-1",
  title: "需求与技术路线",
  description: "跟踪需求、技术和产能",
  nodeId: "node-1",
  relationType: "research_note",
};

function renderViewer(enabled = true) {
  return renderToStaticMarkup(
    React.createElement(EmbeddedMindMapViewer, { mindMap, enabled }),
  );
}

describe("投研笔记只读导图懒加载", () => {
  beforeEach(() => useQuery.mockReset());

  it("进入视口前不挂载导图查询", () => {
    const html = renderViewer(false);

    expect(useQuery).not.toHaveBeenCalled();
    expect(html).toContain("滚动至此加载导图");
  });

  it("进入视口后只查询当前导图并显示加载状态", () => {
    useQuery.mockReturnValue({ isLoading: true, isFetching: false });

    expect(renderViewer()).toContain("正在加载思维导图");
    expect(useQuery).toHaveBeenCalledWith(
      { id: "mind-map-1" },
      { retry: false },
    );
  });

  it("区分导图不存在和可重试的查询失败", () => {
    useQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: true,
      error: { data: { code: "NOT_FOUND" } },
    });
    expect(renderViewer()).toContain("导图不存在或已被删除");

    useQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: true,
      error: { data: { code: "INTERNAL_SERVER_ERROR" } },
      refetch: vi.fn(),
    });
    const failedHtml = renderViewer();
    expect(failedHtml).toContain("思维导图加载失败");
    expect(failedHtml).toContain("重试");
  });

  it("成功后提供只读画布的缩放和适应视图操作", () => {
    useQuery.mockReturnValue({
      isLoading: false,
      isFetching: false,
      isError: false,
      data: {
        data: { root: { data: { text: "中心主题" }, children: [] } },
        config: {},
      },
    });
    const html = renderViewer();

    expect(html).toContain('aria-label="缩小导图"');
    expect(html).toContain('aria-label="放大导图"');
    expect(html).toContain('aria-label="适应导图视图"');
    expect(html).toContain("正在初始化思维导图");
  });

  it("使用视口观察器，并强制只读且不恢复编辑视口", () => {
    const source = readFileSync(
      "app/research-targets/research-note-mind-map-links.tsx",
      "utf8",
    );
    const canvasSource = readFileSync(
      "app/mind-maps/mind-map-editor.tsx",
      "utf8",
    );

    expect(source).toContain("new IntersectionObserver");
    expect(source).toContain('rootMargin: "200px 0px"');
    expect(source).toContain("<LoadedMindMapViewer mindMap={mindMap} />");
    expect(source).toContain("readonly");
    expect(source).toContain("restoreView={false}");
    expect(source).toContain("fitOnReady");
    expect(canvasSource.indexOf("...initialConfigRef.current")).toBeLessThan(
      canvasSource.indexOf("readonly: initialReadonlyRef.current"),
    );
    expect(canvasSource).toContain("if (!initialReadonlyRef.current)");
  });
});

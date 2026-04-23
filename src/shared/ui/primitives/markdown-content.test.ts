import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "~/shared/ui/primitives/markdown-content";

describe("MarkdownContent", () => {
  it("renders GFM markdown while escaping raw html", () => {
    const markup = renderToStaticMarkup(
      React.createElement(MarkdownContent, {
        content: [
          "## 标题",
          "",
          "这是 **重点** 内容。",
          "",
          "- 条目一",
          "- 条目二",
          "",
          "> 引用说明",
          "",
          "访问 [官网](https://example.com)",
          "",
          "`npm test`",
          "",
          "| 列 1 | 列 2 |",
          "| --- | --- |",
          "| A | B |",
          "",
          "<script>alert('xss')</script>",
        ].join("\n"),
      }),
    );

    expect(markup).toContain("<h2");
    expect(markup).toMatch(/<strong[^>]*>重点<\/strong>/);
    expect(markup).toContain("<ul");
    expect(markup).toContain("<blockquote");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toMatch(/<code[^>]*>npm test<\/code>/);
    expect(markup).toContain("<table");
    expect(markup).not.toContain("<script>alert('xss')</script>");
    expect(markup).toContain(
      "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  remarkStockMentions,
  replaceStockMentionsInMarkdown,
} from "~/app/_components/stock-mention";

describe("A 股公司名称标记", () => {
  it("按较长名称优先标记文本中的股票名称", () => {
    const content = "平安银行的净息差高于平安。";
    const result = replaceStockMentionsInMarkdown(content, [
      { stockCode: "000002", stockName: "平安" },
      { stockCode: "000001", stockName: "平安银行" },
    ]);

    expect(result).toBe(
      "[平安银行](stock-mention:000001)的净息差高于[平安](stock-mention:000002)。",
    );
  });

  it("不处理代码节点和已有链接", () => {
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "平安银行" }] },
        { type: "code", value: "平安银行" },
        {
          type: "link",
          url: "https://example.com",
          children: [{ type: "text", value: "平安银行" }],
        },
      ],
    };
    const transformer = remarkStockMentions([
      { stockCode: "000001", stockName: "平安银行" },
    ]);

    transformer(tree);

    expect(tree.children[0]?.children?.[0]?.type).toBe("link");
    expect(tree.children[1]?.value).toBe("平安银行");
    expect(tree.children[2]?.url).toBe("https://example.com");
  });
});

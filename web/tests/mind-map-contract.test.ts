import { describe, expect, it } from "vitest";

import {
  collectionSchema,
  createCollectionInputSchema,
} from "~/contracts/collection";
import {
  createMindMapInputSchema,
  updateMindMapInputSchema,
} from "~/contracts/mind-map";

describe("思维导图与统一收藏契约", () => {
  it("统一收藏保留类型专属 payload", () => {
    const input = createCollectionInputSchema.parse({
      collectionType: "COMPANY",
      title: "贵州茅台",
      payload: { stockCode: "600519" },
    });

    expect(input.tags).toEqual([]);
    expect(input.payload).toEqual({ stockCode: "600519" });
  });

  it("拒绝数组形式的导图数据", () => {
    const result = createMindMapInputSchema.safeParse({
      title: "测试导图",
      data: [],
    });

    expect(result.success).toBe(false);
  });

  it("创建导图时默认没有关联收藏", () => {
    const input = createMindMapInputSchema.parse({
      title: "行业推演",
      data: { root: { data: { text: "中心主题" }, children: [] } },
    });

    expect(input.collectionIds).toEqual([]);
  });

  it("更新导图允许显式清空描述和配置", () => {
    const input = updateMindMapInputSchema.parse({
      id: "map-1",
      description: null,
      config: null,
    });

    expect(input.description).toBeNull();
    expect(input.config).toBeNull();
  });

  it("输出收藏包含可演进的业务字段", () => {
    const collection = collectionSchema.parse({
      id: "collection-1",
      collectionType: "WATCHLIST",
      title: "核心持仓",
      description: null,
      tags: ["长期"],
      payload: { stocks: [] },
      archivedAt: null,
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(collection.collectionType).toBe("WATCHLIST");
  });
});

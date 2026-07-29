import { describe, expect, it } from "vitest";

import {
  EMPTY_MIND_MAP_SELECTION,
  getMindMapImportExtension,
  normalizeHyperlink,
  normalizeMindMapConfig,
  normalizeMindMapData,
  normalizeNodeTags,
  parseMindMapJson,
  validateMindMapImage,
} from "~/app/mind-maps/mind-map-model";
import { MindMapSaveQueue } from "~/app/mind-maps/mind-map-save-queue";
import { getMindMapToolbarCapabilities } from "~/app/mind-maps/mind-map-toolbar";

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = () => nextResolve();
  });
  return { promise, resolve };
}

describe("思维导图编辑器模型", () => {
  it("为旧导图补齐根节点、结构、主题和视图", () => {
    const data = normalizeMindMapData({ root: { data: {} } });
    expect(data.root.data.text).toBe("中心主题");
    expect(data.root.children).toEqual([]);
    expect(data.layout).toBe("logicalStructure");
    expect(data.theme).toEqual({ template: "default", config: {} });
    expect(data.view).toEqual({});
  });

  it("规范化配置并保留未知兼容字段", () => {
    const config = normalizeMindMapConfig({
      mousewheelAction: "move",
      exportPaddingX: 999,
      futureOption: "keep",
    });
    expect(config.mousewheelAction).toBe("move");
    expect(config.exportPaddingX).toBe(200);
    expect(config.futureOption).toBe("keep");
  });

  it("校验节点图片类型和 1 MiB 大小限制", () => {
    expect(validateMindMapImage({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateMindMapImage({ type: "image/svg+xml", size: 1024 })).toContain(
      "PNG",
    );
    expect(
      validateMindMapImage({ type: "image/webp", size: 1024 * 1024 + 1 }),
    ).toContain("1 MiB");
  });

  it("规范化链接与最多五个去重标签", () => {
    expect(normalizeHyperlink("example.com/report")).toBe(
      "https://example.com/report",
    );
    expect(normalizeHyperlink("mailto:test@example.com")).toBe(
      "mailto:test@example.com",
    );
    expect(
      normalizeNodeTags(["风险", "风险", "催化", "估值", "业绩", "资金", "情绪"]),
    ).toEqual(["风险", "催化", "估值", "业绩", "资金"]);
  });

  it("识别导入格式并在解析失败时不产生导图对象", () => {
    expect(getMindMapImportExtension("research.XMIND")).toBe("xmind");
    expect(getMindMapImportExtension("research.txt")).toBeNull();
    expect(() => parseMindMapJson("[]")).toThrow("有效的导图对象");
    expect(parseMindMapJson('{"root":{"data":{"text":"测试"}}}')).toHaveProperty(
      "root",
    );
  });

  it("根据节点选择状态禁用无效工具命令", () => {
    expect(getMindMapToolbarCapabilities(EMPTY_MIND_MAP_SELECTION)).toEqual({
      hasSelection: false,
      canInsertSibling: false,
      canActOnNode: false,
    });
    expect(
      getMindMapToolbarCapabilities({
        ...EMPTY_MIND_MAP_SELECTION,
        count: 1,
        hasRoot: true,
      }).canInsertSibling,
    ).toBe(false);
    expect(
      getMindMapToolbarCapabilities({
        ...EMPTY_MIND_MAP_SELECTION,
        count: 2,
      }).canActOnNode,
    ).toBe(true);
  });
});

describe("思维导图自动保存队列", () => {
  it("保存期间再次编辑会串行提交最新快照", async () => {
    const queue = new MindMapSaveQueue<number>();
    const first = deferred();
    const snapshots: number[] = [];
    const statuses: string[] = [];
    let current = 1;
    let callCount = 0;
    queue.markChanged();
    const flush = queue.flush({
      getSnapshot: () => current,
      save: async (snapshot) => {
        snapshots.push(snapshot);
        callCount += 1;
        if (callCount === 1) await first.promise;
      },
      onStatus: (status) => statuses.push(status),
      onError: () => undefined,
    });
    await Promise.resolve();
    current = 2;
    queue.markChanged();
    first.resolve();
    await flush;

    expect(snapshots).toEqual([1, 2]);
    expect(statuses).toEqual(["saving", "saving", "saved"]);
    expect(queue.hasPending).toBe(false);
  });

  it("失败后保留待保存状态并允许手动重试", async () => {
    const queue = new MindMapSaveQueue<number>();
    const statuses: string[] = [];
    let fail = true;
    queue.markChanged();
    const callbacks = {
      getSnapshot: () => 1,
      save: async () => {
        if (fail) throw new Error("network");
      },
      onStatus: (status: "saved" | "dirty" | "saving" | "error") =>
        statuses.push(status),
      onError: () => undefined,
    };

    await queue.flush(callbacks);
    expect(queue.hasPending).toBe(true);
    fail = false;
    await queue.flush(callbacks);
    expect(queue.hasPending).toBe(false);
    expect(statuses).toEqual(["saving", "error", "saving", "saved"]);
  });
});

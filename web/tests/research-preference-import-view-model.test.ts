import { describe, expect, it, vi } from "vitest";
import type { ResearchPreferenceImportCandidate } from "~/contracts/research-preference";
import {
  beginImportConfirmation,
  buildImportCandidateGroups,
  cancelImportConfirmation,
  createImportState,
  executeResearchPreferenceImport,
  failImport,
  getImportSubmission,
  reconcileImportSelection,
  selectImportGroup,
  succeedImport,
  toggleImportCandidate,
} from "~/app/settings/research-preference-import-view-model";

const candidates: ResearchPreferenceImportCandidate[] = [
  {
    targetType: "COMPANY",
    targetKey: "000001",
    source: "SAVED_COMPANY",
    sources: [
      { source: "SAVED_COMPANY" },
      { source: "WATCHLIST", name: "核心观察" },
    ],
    label: "平安银行",
  },
  {
    targetType: "COMPANY",
    targetKey: "600519",
    source: "WATCHLIST",
    sources: [{ source: "WATCHLIST", name: "消费观察" }],
    label: "贵州茅台",
  },
  {
    targetType: "INDUSTRY",
    targetKey: "申万:银行",
    source: "SAVED_INDUSTRY",
    sources: [{ source: "SAVED_INDUSTRY" }],
    label: "银行",
  },
];

describe("研究关注导入视图状态", () => {
  it("按公司和行业分组且默认不选，已关注对象不可选择", () => {
    const groups = buildImportCandidateGroups(candidates, [
      { targetType: "COMPANY", targetKey: "000001", level: "REGULAR" },
    ]);
    const state = createImportState();

    expect(groups.map((group) => [group.id, group.items.length])).toEqual([
      ["COMPANY", 2],
      ["INDUSTRY", 1],
    ]);
    expect(groups[0]?.items[0]?.alreadyFollowing).toBe(true);
    expect(state.selectedKeys).toEqual([]);
    expect(beginImportConfirmation(state, "command-without-selection")).toBe(
      state,
    );
  });

  it("分组全选跳过已关注对象并可逐项取消", () => {
    const groups = buildImportCandidateGroups(candidates, [
      { targetType: "COMPANY", targetKey: "000001", level: "REGULAR" },
    ]);
    const selected = selectImportGroup(createImportState(), groups[0]!, true);
    const toggled = toggleImportCandidate(selected, "COMPANY:600519");

    expect(selected.selectedKeys).toEqual(["COMPANY:600519"]);
    expect(toggled.selectedKeys).toEqual([]);
  });

  it("确认后生成提交内容，失败复用 commandId，成功后清空", () => {
    const selected = toggleImportCandidate(
      createImportState(),
      "INDUSTRY:申万:银行",
    );
    const confirming = beginImportConfirmation(selected, "stable-command-id");
    const failed = failImport(confirming, "网络暂时不可用");
    const succeeded = succeedImport(failed, 1);

    expect(confirming).toMatchObject({
      confirmationOpen: true,
      commandId: "stable-command-id",
      selectedKeys: ["INDUSTRY:申万:银行"],
    });
    expect(failed).toMatchObject({
      commandId: "stable-command-id",
      selectedKeys: ["INDUSTRY:申万:银行"],
      errorMessage: "网络暂时不可用",
    });
    expect(succeeded).toMatchObject({
      confirmationOpen: false,
      commandId: null,
      selectedKeys: [],
      importedCount: 1,
    });
  });

  it("只提交选中的可导入对象并生成公司行业摘要", () => {
    const groups = buildImportCandidateGroups(candidates, [
      { targetType: "COMPANY", targetKey: "000001", level: "REGULAR" },
    ]);
    const selected = selectImportGroup(createImportState(), groups[1]!, true);
    const confirming = beginImportConfirmation(selected, "summary-command");

    expect(getImportSubmission(confirming, groups)).toEqual({
      commandId: "summary-command",
      targets: [{ targetType: "INDUSTRY", targetKey: "申万:银行" }],
      summary: { companies: 0, industries: 1, total: 1 },
    });
    expect(cancelImportConfirmation(confirming)).toMatchObject({
      confirmationOpen: false,
      commandId: null,
      selectedKeys: ["INDUSTRY:申万:银行"],
    });
  });

  it("确认后调用导入并在成功时刷新两条查询", async () => {
    const groups = buildImportCandidateGroups(candidates, []);
    const confirming = beginImportConfirmation(
      toggleImportCandidate(createImportState(), "INDUSTRY:申万:银行"),
      "execute-command",
    );
    const importTargets = vi.fn().mockResolvedValue({
      items: [
        { targetType: "INDUSTRY", targetKey: "申万:银行", level: "REGULAR" },
      ],
    });
    const refresh = vi.fn().mockResolvedValue(undefined);

    const next = await executeResearchPreferenceImport({
      state: confirming,
      groups,
      currentItems: [],
      importTargets,
      refresh,
    });

    expect(importTargets).toHaveBeenCalledWith({
      commandId: "execute-command",
      targets: [{ targetType: "INDUSTRY", targetKey: "申万:银行" }],
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(next).toMatchObject({ selectedKeys: [], importedCount: 1 });
  });

  it("导入失败不刷新并保留选择与 commandId 供重试", async () => {
    const groups = buildImportCandidateGroups(candidates, []);
    const confirming = beginImportConfirmation(
      toggleImportCandidate(createImportState(), "COMPANY:600519"),
      "retry-command",
    );
    const refresh = vi.fn();

    const next = await executeResearchPreferenceImport({
      state: confirming,
      groups,
      currentItems: [],
      importTargets: vi.fn().mockRejectedValue(new Error("服务不可用")),
      refresh,
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(next).toMatchObject({
      confirmationOpen: true,
      commandId: "retry-command",
      selectedKeys: ["COMPANY:600519"],
      errorMessage: "服务不可用",
    });
  });

  it("刷新后移除已经关注或已经消失的旧选择", () => {
    const groups = buildImportCandidateGroups(candidates, [
      { targetType: "COMPANY", targetKey: "000001", level: "REGULAR" },
    ]);
    const staleState = {
      ...createImportState(),
      selectedKeys: ["COMPANY:000001", "INDUSTRY:申万:银行", "COMPANY:已删除"],
    };

    expect(reconcileImportSelection(staleState, groups).selectedKeys).toEqual([
      "INDUSTRY:申万:银行",
    ]);

    const invalidConfirmation = beginImportConfirmation(
      { ...createImportState(), selectedKeys: ["COMPANY:000001"] },
      "stale-confirmation",
    );
    expect(reconcileImportSelection(invalidConfirmation, groups)).toMatchObject({
      selectedKeys: [],
      confirmationOpen: false,
      commandId: null,
    });
  });
});

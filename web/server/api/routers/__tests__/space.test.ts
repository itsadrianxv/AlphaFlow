import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCaller } from "~/server/api/root";

vi.mock("~/server/auth", () => ({
  auth: vi.fn(),
}));

type ResearchSpaceRecord = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  briefJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type ResearchSpaceRunLinkRecord = {
  id: string;
  spaceId: string;
  runId: string;
  note: string | null;
  createdAt: Date;
};

type ResearchSpaceWatchListLinkRecord = {
  id: string;
  spaceId: string;
  watchListId: string;
  createdAt: Date;
};

type ResearchSpaceStockLinkRecord = {
  id: string;
  spaceId: string;
  stockCode: string;
  stockName: string;
  createdAt: Date;
};

type WorkflowRunRecord = {
  id: string;
  userId: string;
  query: string;
  status: string;
  progressPercent: number;
  currentNodeKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  template: {
    code: string;
    version: number;
  };
};

type WatchListRecord = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
};

const defaultBrief = {
  researchGoal: "",
  coreThesis: "",
  keyQuestions: [],
  focusDimensions: [],
  notes: "",
};

function sortByDateDesc<T extends { createdAt: Date }>(items: T[]) {
  return [...items].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
}

function createMockDb() {
  let nextId = 0;
  const createId = (prefix: string) => `${prefix}-${++nextId}`;

  const spaces: ResearchSpaceRecord[] = [];
  const runLinks: ResearchSpaceRunLinkRecord[] = [];
  const watchListLinks: ResearchSpaceWatchListLinkRecord[] = [];
  const stockLinks: ResearchSpaceStockLinkRecord[] = [];
  const workflowRuns: WorkflowRunRecord[] = [
    {
      id: "run-1",
      userId: "user-1",
      query: "半导体设备国产替代的订单兑现节奏",
      status: "SUCCEEDED",
      progressPercent: 100,
      currentNodeKey: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-04-08T08:00:00.000Z"),
      startedAt: new Date("2026-04-08T08:01:00.000Z"),
      completedAt: new Date("2026-04-08T08:05:00.000Z"),
      input: { query: "半导体设备国产替代的订单兑现节奏" },
      result: {
        overview: "国内设备厂商验证继续推进。",
        heatScore: 72,
        heatConclusion: "国产替代订单兑现继续强化。",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "海外龙头竞争仍强。",
        generatedAt: "2026-04-08T08:05:00.000Z",
      },
      template: {
        code: "quick_industry_research",
        version: 3,
      },
    },
    {
      id: "run-2",
      userId: "user-1",
      query: "宁德时代海外产能兑现",
      status: "RUNNING",
      progressPercent: 40,
      currentNodeKey: "agent4_synthesis",
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-04-09T08:00:00.000Z"),
      startedAt: new Date("2026-04-09T08:01:00.000Z"),
      completedAt: null,
      input: { companyName: "宁德时代", stockCode: "300750" },
      result: null,
      template: {
        code: "company_research_center",
        version: 4,
      },
    },
    {
      id: "run-3",
      userId: "user-2",
      query: "不属于当前用户的 run",
      status: "SUCCEEDED",
      progressPercent: 100,
      currentNodeKey: null,
      errorCode: null,
      errorMessage: null,
      createdAt: new Date("2026-04-10T08:00:00.000Z"),
      startedAt: new Date("2026-04-10T08:01:00.000Z"),
      completedAt: new Date("2026-04-10T08:02:00.000Z"),
      input: { query: "别人的 run" },
      result: {
        overview: "others",
        heatScore: 10,
        heatConclusion: "others",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "others",
        generatedAt: "2026-04-10T08:02:00.000Z",
      },
      template: {
        code: "quick_industry_research",
        version: 3,
      },
    },
  ];
  const watchLists: WatchListRecord[] = [
    {
      id: "watchlist-1",
      userId: "user-1",
      name: "设备观察池",
      description: "半导体设备",
    },
    {
      id: "watchlist-2",
      userId: "user-2",
      name: "别人的列表",
      description: null,
    },
  ];

  const db = {
    researchSpace: {
      async create(args: {
        data: Omit<ResearchSpaceRecord, "id" | "createdAt" | "updatedAt"> & {
          createdAt?: Date;
          updatedAt?: Date;
          id?: string;
        };
      }) {
        const record: ResearchSpaceRecord = {
          id: args.data.id ?? createId("space"),
          userId: args.data.userId,
          name: args.data.name,
          description: args.data.description ?? null,
          briefJson: structuredClone(args.data.briefJson),
          createdAt: args.data.createdAt ?? new Date(),
          updatedAt: args.data.updatedAt ?? new Date(),
        };
        spaces.push(record);
        return structuredClone(record);
      },
      async findMany(args?: { where?: Partial<ResearchSpaceRecord> }) {
        return sortByDateDesc(
          spaces.filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceRecord] === value,
            ),
          ),
        ).map((item) => structuredClone(item));
      },
      async findFirst(args: { where: Partial<ResearchSpaceRecord> }) {
        const record =
          spaces.find((item) =>
            Object.entries(args.where).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceRecord] === value,
            ),
          ) ?? null;
        return record ? structuredClone(record) : null;
      },
      async update(args: {
        where: Pick<ResearchSpaceRecord, "id">;
        data: Partial<ResearchSpaceRecord>;
      }) {
        const record = spaces.find((item) => item.id === args.where.id);
        if (!record) {
          throw new Error("space not found");
        }
        Object.assign(record, structuredClone(args.data));
        record.updatedAt = args.data.updatedAt ?? new Date();
        return structuredClone(record);
      },
    },
    researchSpaceRunLink: {
      async create(args: {
        data: Omit<ResearchSpaceRunLinkRecord, "id" | "createdAt"> & {
          createdAt?: Date;
          id?: string;
        };
      }) {
        const record: ResearchSpaceRunLinkRecord = {
          id: args.data.id ?? createId("space-run-link"),
          spaceId: args.data.spaceId,
          runId: args.data.runId,
          note: args.data.note ?? null,
          createdAt: args.data.createdAt ?? new Date(),
        };
        const exists = runLinks.some(
          (item) =>
            item.spaceId === record.spaceId && item.runId === record.runId,
        );
        if (!exists) {
          runLinks.push(record);
        }
        return structuredClone(record);
      },
      async findMany(args?: { where?: Partial<ResearchSpaceRunLinkRecord> }) {
        return sortByDateDesc(
          runLinks.filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceRunLinkRecord] === value,
            ),
          ),
        ).map((item) => structuredClone(item));
      },
      async deleteMany(args: { where: Partial<ResearchSpaceRunLinkRecord> }) {
        const before = runLinks.length;
        for (let index = runLinks.length - 1; index >= 0; index -= 1) {
          const item = runLinks[index];
          if (
            item &&
            Object.entries(args.where).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceRunLinkRecord] === value,
            )
          ) {
            runLinks.splice(index, 1);
          }
        }
        return { count: before - runLinks.length };
      },
    },
    researchSpaceWatchListLink: {
      async create(args: {
        data: Omit<ResearchSpaceWatchListLinkRecord, "id" | "createdAt"> & {
          createdAt?: Date;
          id?: string;
        };
      }) {
        const record: ResearchSpaceWatchListLinkRecord = {
          id: args.data.id ?? createId("space-watchlist-link"),
          spaceId: args.data.spaceId,
          watchListId: args.data.watchListId,
          createdAt: args.data.createdAt ?? new Date(),
        };
        const exists = watchListLinks.some(
          (item) =>
            item.spaceId === record.spaceId &&
            item.watchListId === record.watchListId,
        );
        if (!exists) {
          watchListLinks.push(record);
        }
        return structuredClone(record);
      },
      async findMany(args?: {
        where?: Partial<ResearchSpaceWatchListLinkRecord>;
      }) {
        return sortByDateDesc(
          watchListLinks.filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceWatchListLinkRecord] === value,
            ),
          ),
        ).map((item) => structuredClone(item));
      },
      async deleteMany(args: {
        where: Partial<ResearchSpaceWatchListLinkRecord>;
      }) {
        const before = watchListLinks.length;
        for (let index = watchListLinks.length - 1; index >= 0; index -= 1) {
          const item = watchListLinks[index];
          if (
            item &&
            Object.entries(args.where).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceWatchListLinkRecord] === value,
            )
          ) {
            watchListLinks.splice(index, 1);
          }
        }
        return { count: before - watchListLinks.length };
      },
    },
    researchSpaceStockLink: {
      async createMany(args: {
        data: Array<
          Omit<ResearchSpaceStockLinkRecord, "id" | "createdAt"> & {
            createdAt?: Date;
            id?: string;
          }
        >;
      }) {
        let count = 0;
        for (const item of args.data) {
          const exists = stockLinks.some(
            (current) =>
              current.spaceId === item.spaceId &&
              current.stockCode === item.stockCode,
          );
          if (!exists) {
            stockLinks.push({
              id: item.id ?? createId("space-stock-link"),
              spaceId: item.spaceId,
              stockCode: item.stockCode,
              stockName: item.stockName,
              createdAt: item.createdAt ?? new Date(),
            });
            count += 1;
          }
        }
        return { count };
      },
      async findMany(args?: { where?: Partial<ResearchSpaceStockLinkRecord> }) {
        return sortByDateDesc(
          stockLinks.filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceStockLinkRecord] === value,
            ),
          ),
        ).map((item) => structuredClone(item));
      },
      async deleteMany(args: { where: Partial<ResearchSpaceStockLinkRecord> }) {
        const before = stockLinks.length;
        for (let index = stockLinks.length - 1; index >= 0; index -= 1) {
          const item = stockLinks[index];
          if (
            item &&
            Object.entries(args.where).every(
              ([key, value]) =>
                item[key as keyof ResearchSpaceStockLinkRecord] === value,
            )
          ) {
            stockLinks.splice(index, 1);
          }
        }
        return { count: before - stockLinks.length };
      },
    },
    workflowRun: {
      async findFirst(args: { where: Partial<WorkflowRunRecord> }) {
        const record =
          workflowRuns.find((item) =>
            Object.entries(args.where).every(
              ([key, value]) => item[key as keyof WorkflowRunRecord] === value,
            ),
          ) ?? null;
        return record ? structuredClone(record) : null;
      },
      async findMany(args?: { where?: Partial<WorkflowRunRecord> }) {
        return sortByDateDesc(
          workflowRuns.filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) => item[key as keyof WorkflowRunRecord] === value,
            ),
          ),
        ).map((item) => structuredClone(item));
      },
    },
    watchList: {
      async findFirst(args: { where: Partial<WatchListRecord> }) {
        const record =
          watchLists.find((item) =>
            Object.entries(args.where).every(
              ([key, value]) => item[key as keyof WatchListRecord] === value,
            ),
          ) ?? null;
        return record ? structuredClone(record) : null;
      },
      async findMany(args?: { where?: Partial<WatchListRecord> }) {
        return watchLists
          .filter((item) =>
            Object.entries(args?.where ?? {}).every(
              ([key, value]) => item[key as keyof WatchListRecord] === value,
            ),
          )
          .map((item) => structuredClone(item));
      },
    },
  };

  return { db, stores: { spaces, runLinks, watchListLinks, stockLinks } };
}

function createContext(mockDb: ReturnType<typeof createMockDb>["db"]) {
  return {
    db: mockDb,
    headers: new Headers(),
    session: {
      user: {
        id: "user-1",
      },
      expires: "2099-01-01T00:00:00.000Z",
    },
  };
}

describe("spaceRouter", () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  it("creates, lists, and updates a research space with a semi-structured brief", async () => {
    const caller = createCaller(createContext(mockDb.db) as never);

    const created = await caller.space.create({
      name: "半导体设备 thesis",
      description: "跟踪国产替代",
      brief: {
        researchGoal: "判断订单兑现速度",
        coreThesis: "先进制程扩产带来设备订单兑现",
        keyQuestions: ["国产设备验证是否继续推进"],
        focusDimensions: ["订单", "验证", "毛利率"],
        notes: "优先追踪北方华创与中微公司",
      },
    });

    expect(created.name).toBe("半导体设备 thesis");
    expect(created.brief.coreThesis).toContain("先进制程");

    const listed = await caller.space.list({
      limit: 10,
      offset: 0,
    });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.runCount).toBe(0);
    expect(listed[0]?.watchListCount).toBe(0);

    const updated = await caller.space.updateBrief({
      spaceId: created.id,
      brief: {
        ...defaultBrief,
        researchGoal: "更新后的目标",
        coreThesis: "新 thesis",
        keyQuestions: ["问题 1", "问题 2"],
        focusDimensions: ["收入兑现"],
        notes: "new note",
      },
    });

    expect(updated.brief.researchGoal).toBe("更新后的目标");

    const detail = await caller.space.getDetail({ spaceId: created.id });

    expect(detail.brief.coreThesis).toBe("新 thesis");
    expect(detail.runLinks).toEqual([]);
    expect(detail.recentSuccessfulRunLinks).toEqual([]);
  });

  it("links a run to multiple spaces and removing one link does not affect the other", async () => {
    const caller = createCaller(createContext(mockDb.db) as never);
    const alpha = await caller.space.create({
      name: "Space Alpha",
      description: "A",
      brief: defaultBrief,
    });
    const beta = await caller.space.create({
      name: "Space Beta",
      description: "B",
      brief: defaultBrief,
    });

    await caller.space.addRun({
      spaceId: alpha.id,
      runId: "run-1",
      note: "核心行业结论",
    });
    await caller.space.addRun({
      spaceId: beta.id,
      runId: "run-1",
      note: "复用到另一个 thesis",
    });

    const alphaRunsBefore = await caller.space.listRunLinks({
      spaceId: alpha.id,
      limit: 10,
    });
    const betaRunsBefore = await caller.space.listRunLinks({
      spaceId: beta.id,
      limit: 10,
    });

    expect(alphaRunsBefore.items).toHaveLength(1);
    expect(betaRunsBefore.items).toHaveLength(1);

    await caller.space.removeRun({
      spaceId: alpha.id,
      runId: "run-1",
    });

    const alphaRunsAfter = await caller.space.listRunLinks({
      spaceId: alpha.id,
      limit: 10,
    });
    const betaRunsAfter = await caller.space.listRunLinks({
      spaceId: beta.id,
      limit: 10,
    });

    expect(alphaRunsAfter.items).toHaveLength(0);
    expect(betaRunsAfter.items).toHaveLength(1);
    expect(betaRunsAfter.items[0]?.note).toContain("复用");
  });

  it("supports watchlist and stock linking on the same space", async () => {
    const caller = createCaller(createContext(mockDb.db) as never);
    const created = await caller.space.create({
      name: "设备 Space",
      description: null,
      brief: defaultBrief,
    });

    await caller.space.linkWatchlist({
      spaceId: created.id,
      watchListId: "watchlist-1",
    });
    await caller.space.linkStocks({
      spaceId: created.id,
      stocks: [
        { stockCode: "300750", stockName: "宁德时代" },
        { stockCode: "688012", stockName: "中微公司" },
      ],
    });

    const detail = await caller.space.getDetail({ spaceId: created.id });

    expect(detail.watchLists).toHaveLength(1);
    expect(detail.stocks).toHaveLength(2);

    await caller.space.unlinkStock({
      spaceId: created.id,
      stockCode: "300750",
    });

    await caller.space.unlinkWatchlist({
      spaceId: created.id,
      watchListId: "watchlist-1",
    });

    const updated = await caller.space.getDetail({ spaceId: created.id });

    expect(updated.watchLists).toEqual([]);
    expect(updated.stocks.map((item) => item.stockCode)).toEqual(["688012"]);
  });

  it("filters space run links by run query and archive note", async () => {
    const caller = createCaller(createContext(mockDb.db) as never);
    const created = await caller.space.create({
      name: "过滤测试",
      description: null,
      brief: defaultBrief,
    });

    await caller.space.addRun({
      spaceId: created.id,
      runId: "run-1",
      note: "供应链证据完整",
    });
    await caller.space.addRun({
      spaceId: created.id,
      runId: "run-2",
      note: "等待公司侧更多确认",
    });

    const byQuery = await caller.space.listRunLinks({
      spaceId: created.id,
      limit: 10,
      search: "宁德时代",
    });
    const byNote = await caller.space.listRunLinks({
      spaceId: created.id,
      limit: 10,
      search: "供应链",
    });

    expect(byQuery.items).toHaveLength(1);
    expect(byQuery.items[0]?.run.query).toContain("宁德时代");
    expect(byNote.items).toHaveLength(1);
    expect(byNote.items[0]?.note).toContain("供应链");
  });

  it("enforces ownership boundaries for foreign runs, watchlists, and spaces", async () => {
    const caller = createCaller(createContext(mockDb.db) as never);
    const created = await caller.space.create({
      name: "权限测试",
      description: null,
      brief: defaultBrief,
    });

    await expect(
      caller.space.addRun({
        spaceId: created.id,
        runId: "run-3",
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    await expect(
      caller.space.linkWatchlist({
        spaceId: created.id,
        watchListId: "watchlist-2",
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const foreignContext = {
      ...createContext(mockDb.db),
      session: {
        ...createContext(mockDb.db).session,
        user: { id: "user-2" },
      },
    };
    const foreignCaller = createCaller(foreignContext as never);

    await expect(
      foreignCaller.space.getDetail({ spaceId: created.id }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

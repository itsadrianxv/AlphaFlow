import type { Prisma } from "@prisma/client";
import { enqueuePersonalizedHomePage } from "~/server/application/homepage/home-page-snapshot-service";
import { db } from "~/server/db";
import {
  buildMindMapData,
  buildResearchNoteMarkdown,
  type ResearchContentSeed,
  researchContentSeeds,
} from "~/tooling/admin-demo-research-content";

const ADMIN_NAME = "admin";
const INDUSTRY_SOURCE = "申万2021一级行业";
const WATCHLIST_NAME = "跨行业研究观察池";
const SEED_SOURCE = "admin-demo-research-collections";

const companies = [
  {
    stockCode: "002594",
    companyName: "比亚迪",
    reason: "演示整车、动力电池、销量、车型、出海及供应链事件的个性化关联。",
    tags: ["新能源汽车", "整车", "出海"],
  },
  {
    stockCode: "688981",
    companyName: "中芯国际",
    reason: "演示晶圆代工、国产半导体设备材料及终端需求变化的产业链关联。",
    tags: ["半导体", "晶圆代工", "国产化"],
  },
  {
    stockCode: "601138",
    companyName: "工业富联",
    reason: "演示 AI 服务器、网络设备、算力基础设施及智能制造需求的主题关联。",
    tags: ["AI算力", "服务器", "智能制造"],
  },
  {
    stockCode: "600276",
    companyName: "恒瑞医药",
    reason: "演示研发管线、临床试验、药品获批及授权合作事件的个性化关联。",
    tags: ["创新药", "研发管线", "国际化"],
  },
  {
    stockCode: "600519",
    companyName: "贵州茅台",
    reason: "演示渠道库存、价格变化、消费景气及分红信息的基本面关联。",
    tags: ["白酒", "消费", "渠道"],
  },
  {
    stockCode: "600036",
    companyName: "招商银行",
    reason: "演示利率、净息差、资产质量、财富管理及分红信息的宏观关联。",
    tags: ["银行", "财富管理", "资产质量"],
  },
  {
    stockCode: "601899",
    companyName: "紫金矿业",
    reason: "演示铜金价格、海外矿山经营及新能源上游资源事件的周期关联。",
    tags: ["铜金", "资源品", "海外项目"],
  },
  {
    stockCode: "300750",
    companyName: "宁德时代",
    reason: "演示动力电池、储能、上游锂资源及下游整车事件的个性化关联。",
    tags: ["动力电池", "储能", "全球化"],
  },
] as const;

const industries = [
  {
    name: "汽车",
    reason: "观察整车销量、车型迭代、出口及零部件供应链事件的行业传播。",
    tags: ["申万一级", "整车", "出口"],
    relatedCompanies: [{ stockCode: "002594", companyName: "比亚迪" }],
  },
  {
    name: "电子",
    reason: "观察半导体、消费电子与 AI 硬件需求之间的交叉影响。",
    tags: ["申万一级", "半导体", "AI硬件"],
    relatedCompanies: [
      { stockCode: "688981", companyName: "中芯国际" },
      { stockCode: "601138", companyName: "工业富联" },
    ],
  },
  {
    name: "计算机",
    reason: "观察 AI 算力、服务器和数字基础设施相关事件的行业影响。",
    tags: ["申万一级", "AI算力", "数字基础设施"],
    relatedCompanies: [{ stockCode: "601138", companyName: "工业富联" }],
  },
  {
    name: "医药生物",
    reason: "观察药品审评审批、临床试验、医保及授权合作事件。",
    tags: ["申万一级", "创新药", "医药政策"],
    relatedCompanies: [{ stockCode: "600276", companyName: "恒瑞医药" }],
  },
  {
    name: "食品饮料",
    reason: "观察消费景气、渠道库存、价格变化及分红事件。",
    tags: ["申万一级", "消费", "渠道"],
    relatedCompanies: [{ stockCode: "600519", companyName: "贵州茅台" }],
  },
  {
    name: "银行",
    reason: "观察利率、净息差、资产质量及财富管理业务变化。",
    tags: ["申万一级", "利率", "资产质量"],
    relatedCompanies: [{ stockCode: "600036", companyName: "招商银行" }],
  },
  {
    name: "有色金属",
    reason: "观察铜金价格、矿山产量、海外经营及新能源上游需求。",
    tags: ["申万一级", "资源品", "铜金"],
    relatedCompanies: [{ stockCode: "601899", companyName: "紫金矿业" }],
  },
  {
    name: "电力设备",
    reason: "观察动力电池、储能、光伏产业链及政策供需变化的行业传播。",
    tags: ["申万一级", "新能源", "储能"],
    relatedCompanies: [
      { stockCode: "300750", companyName: "宁德时代" },
      { stockCode: "300274", companyName: "阳光电源" },
    ],
  },
] as const;

const watchlistStocks = [
  {
    stockCode: "300750",
    stockName: "宁德时代",
    note: "动力电池与储能链核心观察对象，关注出货、价格、产能利用率及海外进展。",
    tags: ["新能源", "电池", "成长"],
  },
  {
    stockCode: "002594",
    stockName: "比亚迪",
    note: "整车、动力电池与出海事件观察，关注销量结构、新车型和海外市场。",
    tags: ["新能源车", "整车", "出海"],
  },
  {
    stockCode: "300274",
    stockName: "阳光电源",
    note: "逆变器和储能观察，关注海外光伏需求、储能订单及盈利能力变化。",
    tags: ["光伏", "储能", "出海"],
  },
  {
    stockCode: "688981",
    stockName: "中芯国际",
    note: "晶圆代工与国产半导体供应链观察，关注产能利用率、制程和资本开支。",
    tags: ["半导体", "国产化", "成长"],
  },
  {
    stockCode: "601138",
    stockName: "工业富联",
    note: "AI 服务器、网络设备与制造需求观察，关注算力订单和产品结构变化。",
    tags: ["AI算力", "服务器", "成长"],
  },
  {
    stockCode: "600276",
    stockName: "恒瑞医药",
    note: "研发管线、临床、获批和合作事件观察，关注关键里程碑与商业化进展。",
    tags: ["创新药", "研发", "事件驱动"],
  },
  {
    stockCode: "600519",
    stockName: "贵州茅台",
    note: "渠道、价格、消费景气和分红观察，关注批价、库存与股东回报。",
    tags: ["消费", "白酒", "现金流"],
  },
  {
    stockCode: "600036",
    stockName: "招商银行",
    note: "净息差、资产质量和财富管理观察，关注利率环境与风险指标变化。",
    tags: ["银行", "利率", "红利"],
  },
  {
    stockCode: "601899",
    stockName: "紫金矿业",
    note: "铜金价格及海外矿山经营事件观察，关注产量、成本与项目投产节奏。",
    tags: ["资源品", "铜金", "周期"],
  },
  {
    stockCode: "600938",
    stockName: "中国海油",
    note: "油价、产量、资本开支和能源安全观察，关注成本、产量目标与分红。",
    tags: ["油气", "能源", "红利"],
  },
] as const;

type NoteSeed = {
  targetType: "company" | "industry" | "watchlist";
  targetId: string;
  title: string;
  contentMarkdown: string;
  tags: string[];
  sourceJson: Prisma.InputJsonValue;
};

async function upsertNote(
  tx: Prisma.TransactionClient,
  userId: string,
  note: NoteSeed,
) {
  const existing = await tx.researchNote.findFirst({
    where: {
      userId,
      targetType: note.targetType,
      targetId: note.targetId,
      title: note.title,
      kind: "演示观察框架",
    },
    orderBy: { updatedAt: "desc" },
  });
  const data = {
    contentMarkdown: note.contentMarkdown,
    rawContent: note.contentMarkdown,
    sourceJson: note.sourceJson,
    tags: note.tags,
  };
  if (existing) {
    return tx.researchNote.update({ where: { id: existing.id }, data });
  }
  return tx.researchNote.create({
    data: {
      userId,
      targetType: note.targetType,
      targetId: note.targetId,
      title: note.title,
      kind: "演示观察框架",
      ...data,
    },
  });
}

function resolveTargetId(
  seed: ResearchContentSeed,
  companyRecords: Map<string, { id: string }>,
  industryRecords: Map<string, { id: string }>,
  watchlistId: string,
) {
  const [, targetKey] = seed.key.split(":", 2);
  const targetId =
    seed.targetType === "company"
      ? companyRecords.get(targetKey ?? "")?.id
      : seed.targetType === "industry"
        ? industryRecords.get(targetKey ?? "")?.id
        : watchlistId;
  if (!targetId) throw new Error(`无法解析研究对象：${seed.key}`);
  return targetId;
}

async function upsertMindMap(
  tx: Prisma.TransactionClient,
  userId: string,
  seed: ResearchContentSeed,
) {
  const title = `${seed.label}研究框架`;
  const existing = await tx.mindMap.findMany({
    where: { userId, title },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing.length > 1) {
    throw new Error(`admin 名下存在 ${existing.length} 张同名导图：${title}`);
  }
  const data = buildMindMapData(seed) as Prisma.InputJsonValue;
  const description = `${seed.scope} 数据由 ${SEED_SOURCE} 一次性脚本维护。`;
  if (existing[0]) {
    return tx.mindMap.update({
      where: { id: existing[0].id },
      data: { description, data, config: { source: SEED_SOURCE } },
      select: { id: true },
    });
  }
  return tx.mindMap.create({
    data: {
      userId,
      title,
      description,
      data,
      config: { source: SEED_SOURCE },
    },
    select: { id: true },
  });
}

async function main() {
  const admins = await db.user.findMany({
    where: { name: ADMIN_NAME, status: "ACTIVE" },
    select: { id: true, name: true, email: true },
  });
  if (admins.length !== 1) {
    throw new Error(`预期找到唯一的活跃 admin，实际找到 ${admins.length} 个。`);
  }
  const admin = admins[0];
  if (!admin) throw new Error("未找到活跃 admin。");

  const result = await db.$transaction(async (tx) => {
    const baseTime = Date.now() - 60_000;
    const companyRecords = new Map<string, { id: string }>();
    for (const [index, company] of companies.entries()) {
      const updatedAt = new Date(baseTime + index * 1_000);
      const record = await tx.savedCompany.upsert({
        where: {
          userId_stockCode: { userId: admin.id, stockCode: company.stockCode },
        },
        create: {
          userId: admin.id,
          stockCode: company.stockCode,
          companyName: company.companyName,
          reason: company.reason,
          tags: [...company.tags],
          metadataJson: { source: SEED_SOURCE, purpose: "本机项目演示" },
          updatedAt,
        },
        update: {
          companyName: company.companyName,
          reason: company.reason,
          tags: [...company.tags],
          metadataJson: { source: SEED_SOURCE, purpose: "本机项目演示" },
          archivedAt: null,
          updatedAt,
        },
        select: { id: true },
      });
      companyRecords.set(company.stockCode, record);
    }

    const industryRecords = new Map<string, { id: string }>();
    for (const [index, industry] of industries.entries()) {
      const updatedAt = new Date(baseTime + 10_000 + index * 1_000);
      const record = await tx.savedIndustry.upsert({
        where: {
          userId_source_name: {
            userId: admin.id,
            source: INDUSTRY_SOURCE,
            name: industry.name,
          },
        },
        create: {
          userId: admin.id,
          name: industry.name,
          source: INDUSTRY_SOURCE,
          reason: industry.reason,
          tags: [...industry.tags],
          relatedCompaniesJson: [...industry.relatedCompanies],
          metadataJson: {
            source: SEED_SOURCE,
            taxonomy: INDUSTRY_SOURCE,
            level: "L1",
            purpose: "本机项目演示",
          },
          updatedAt,
        },
        update: {
          reason: industry.reason,
          tags: [...industry.tags],
          relatedCompaniesJson: [...industry.relatedCompanies],
          metadataJson: {
            source: SEED_SOURCE,
            taxonomy: INDUSTRY_SOURCE,
            level: "L1",
            purpose: "本机项目演示",
          },
          archivedAt: null,
          updatedAt,
        },
        select: { id: true },
      });
      industryRecords.set(industry.name, record);
    }

    const existingWatchlists = await tx.watchList.findMany({
      where: { userId: admin.id, name: WATCHLIST_NAME },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (existingWatchlists.length > 1) {
      throw new Error(
        `admin 名下存在 ${existingWatchlists.length} 个同名自选股列表，请先处理重复数据。`,
      );
    }
    const watchlistData = {
      description:
        "用于演示筛选、组合研究和跨行业事件影响，不代表实际持仓或投资建议。",
      stocks: watchlistStocks.map((stock, index) => ({
        ...stock,
        tags: [...stock.tags],
        addedAt: new Date(baseTime + 20_000 + index * 1_000).toISOString(),
      })),
      updatedAt: new Date(baseTime + 30_000),
    };
    const watchlist = existingWatchlists[0]
      ? await tx.watchList.update({
          where: { id: existingWatchlists[0].id },
          data: watchlistData,
          select: { id: true },
        })
      : await tx.watchList.create({
          data: { userId: admin.id, name: WATCHLIST_NAME, ...watchlistData },
          select: { id: true },
        });

    const noteIds: string[] = [];
    const mindMapIds: string[] = [];
    for (const seed of researchContentSeeds) {
      const targetId = resolveTargetId(
        seed,
        companyRecords,
        industryRecords,
        watchlist.id,
      );
      const mindMap = await upsertMindMap(tx, admin.id, seed);
      const note = await upsertNote(tx, admin.id, {
        targetType: seed.targetType,
        targetId,
        title: `${seed.label}深度研究笔记`,
        contentMarkdown: buildResearchNoteMarkdown(seed, mindMap.id),
        tags: [...seed.tags, "演示研究"],
        sourceJson: {
          source: SEED_SOURCE,
          mindMapId: mindMap.id,
          sources: seed.sources,
        },
      });

      await tx.mindMapReference.deleteMany({
        where: { mindMapId: mindMap.id },
      });
      await tx.mindMapReference.createMany({
        data: [
          {
            mindMapId: mindMap.id,
            nodeId: `${seed.key}:root`,
            targetType: "note",
            targetId: note.id,
            relationType: "research_note",
          },
          {
            mindMapId: mindMap.id,
            nodeId: `${seed.key}:root`,
            targetType: seed.targetType,
            targetId,
            relationType: "research_target",
          },
        ],
      });
      noteIds.push(note.id);
      mindMapIds.push(mindMap.id);
    }

    await tx.researchNote.deleteMany({
      where: {
        userId: admin.id,
        sourceJson: { path: ["source"], equals: SEED_SOURCE },
        id: { notIn: noteIds },
      },
    });

    return {
      companyCount: companyRecords.size,
      industryCount: industryRecords.size,
      watchlistId: watchlist.id,
      watchlistStockCount: watchlistStocks.length,
      noteCount: noteIds.length,
      mindMapCount: mindMapIds.length,
      mindMapReferenceCount: mindMapIds.length * 2,
    };
  });

  const homepageTask = await enqueuePersonalizedHomePage(
    db,
    admin.id,
    "ADMIN_DEMO_COLLECTIONS_SEEDED",
    false,
  );
  console.log(
    JSON.stringify(
      {
        admin,
        ...result,
        homepageRefreshQueued: Boolean(homepageTask),
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });

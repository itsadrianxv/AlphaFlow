import type { QuickResearchCandidate } from "~/server/domain/workflow/types";

type CandidatePoolKey = "ai" | "semicon" | "new_energy";

const CANDIDATE_POOL: Record<
  CandidatePoolKey,
  Array<Omit<QuickResearchCandidate, "score">>
> = {
  ai: [
    { stockCode: "002230", stockName: "科大讯飞", reason: "AI 应用生态和行业落地丰富" },
    { stockCode: "603019", stockName: "中科曙光", reason: "算力基础设施与政企订单稳健" },
    { stockCode: "300308", stockName: "中际旭创", reason: "光模块受益于 AI 数据中心资本开支" },
  ],
  semicon: [
    { stockCode: "688981", stockName: "中芯国际", reason: "先进制造稼动率改善" },
    { stockCode: "603986", stockName: "兆易创新", reason: "存储与 MCU 需求复苏" },
    { stockCode: "688012", stockName: "中微公司", reason: "设备国产替代持续推进" },
  ],
  new_energy: [
    { stockCode: "300750", stockName: "宁德时代", reason: "储能与动力电池双轮驱动" },
    { stockCode: "002594", stockName: "比亚迪", reason: "整车与电池垂直整合优势明显" },
    { stockCode: "601012", stockName: "隆基绿能", reason: "光伏主链成本竞争力突出" },
  ],
};

const DEFAULT_POOL = [
  { stockCode: "600036", stockName: "招商银行", reason: "资产质量稳健、估值具备安全垫" },
  { stockCode: "600519", stockName: "贵州茅台", reason: "现金流和品牌护城河显著" },
  { stockCode: "601318", stockName: "中国平安", reason: "保险+投资组合具备修复弹性" },
];

export class ScreeningFacade {
  async screenCandidates(query: string, heatScore: number): Promise<QuickResearchCandidate[]> {
    const normalized = query.toLowerCase();

    const basePool: Array<Omit<QuickResearchCandidate, "score">> =
      normalized.includes("ai") || normalized.includes("人工智能")
        ? CANDIDATE_POOL.ai
        : normalized.includes("半导体") || normalized.includes("芯片")
          ? CANDIDATE_POOL.semicon
          : normalized.includes("新能源") || normalized.includes("储能")
            ? CANDIDATE_POOL.new_energy
            : DEFAULT_POOL;

    return basePool.map((item, index) => ({
      ...item,
      score: Math.max(60, Math.min(95, heatScore - index * 6 + 8)),
    }));
  }
}

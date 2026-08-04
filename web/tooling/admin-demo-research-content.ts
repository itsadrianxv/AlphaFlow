export type ResearchSource = {
  label: string;
  url: string;
  purpose: string;
};

export type ResearchContentSeed = {
  key: string;
  targetType: "company" | "industry" | "watchlist";
  label: string;
  scope: string;
  business: string[];
  drivers: string[];
  metrics: string[];
  events: string[];
  risks: string[];
  questions: string[];
  sources: ResearchSource[];
  tags: string[];
};

const regulatorSources = {
  cninfo: {
    label: "巨潮资讯",
    url: "https://www.cninfo.com.cn/new/index",
    purpose: "核验深交所公司公告、定期报告和投资者关系记录",
  },
  sse: {
    label: "上交所公告",
    url: "https://www.sse.com.cn/disclosure/listedinfo/announcement/",
    purpose: "核验上交所公司公告和定期报告",
  },
  stats: {
    label: "国家统计局",
    url: "https://www.stats.gov.cn/sj/",
    purpose: "跟踪宏观经济、工业生产和消费统计",
  },
  sw: {
    label: "申万行业分类（TuShare）",
    url: "https://tushare.pro/document/2?doc_id=181",
    purpose: "核验申万 2021 行业口径、层级和分类代码",
  },
} as const;

export const researchContentSeeds: ResearchContentSeed[] = [
  {
    key: "company:300750",
    targetType: "company",
    label: "宁德时代",
    scope:
      "动力电池与储能系统龙头样本，研究重点是量价、技术路线、产能利用和全球化的联动。",
    business: ["动力电池系统", "储能电池系统", "电池材料与回收闭环"],
    drivers: [
      "全球新能源汽车销量与单车带电量",
      "储能装机、招标价格与安全标准",
      "锂资源价格、产品结构与海外客户放量",
    ],
    metrics: [
      "动力及储能电池销量与市占率",
      "毛利率、单位盈利和经营现金流",
      "产能利用率、资本开支和海外收入占比",
    ],
    events: [
      "新产品、量产节点与客户定点",
      "海外工厂审批、建设和投产",
      "原材料价格、回收政策与贸易规则变化",
    ],
    risks: [
      "行业供给扩张导致价格竞争",
      "技术路线迭代或安全事件",
      "海外监管、贸易壁垒和项目执行偏差",
    ],
    questions: [
      "储能业务能否形成区别于动力电池的盈利曲线？",
      "海外本地化产能对客户结构和资本回报有何影响？",
      "原材料下行的成本收益在产业链如何分配？",
    ],
    sources: [
      {
        label: "宁德时代投资者关系",
        url: "https://www.catl.com/investors/",
        purpose: "核验定期报告、临时公告和投资者交流材料",
      },
      regulatorSources.cninfo,
      {
        label: "国家能源局",
        url: "https://www.nea.gov.cn/",
        purpose: "跟踪新型储能政策、装机和电力系统信息",
      },
    ],
    tags: ["动力电池", "储能", "全球化"],
  },
  {
    key: "company:002594",
    targetType: "company",
    label: "比亚迪",
    scope:
      "整车、电池和汽车电子纵向一体化样本，研究销量结构、产品周期、出海与供应链协同。",
    business: ["新能源汽车整车", "动力电池与储能", "汽车电子及零部件"],
    drivers: [
      "车型周期、终端需求和渠道覆盖",
      "插混与纯电结构、售价和促销强度",
      "出口、本地化生产与供应链协同",
    ],
    metrics: [
      "月度销量、出口量和车型结构",
      "单车收入、汽车业务毛利率和现金流",
      "库存、产能利用率和海外市场进度",
    ],
    events: [
      "新车型上市、改款和价格调整",
      "海外市场准入、工厂建设与渠道扩张",
      "电池技术、安全事件和供应链变化",
    ],
    risks: [
      "价格竞争压缩单车盈利",
      "海外贸易壁垒与本地经营风险",
      "车型迭代不及预期或库存上升",
    ],
    questions: [
      "销量增长由价格、车型还是区域结构驱动？",
      "海外销量增长能否转化为稳定盈利？",
      "纵向一体化在价格周期中提供多大缓冲？",
    ],
    sources: [
      {
        label: "比亚迪投资者关系",
        url: "https://www.bydglobal.com/cn/Investor.html",
        purpose: "核验公司公告、报告与投资者关系资料",
      },
      regulatorSources.cninfo,
      {
        label: "中国汽车工业协会",
        url: "https://www.caam.org.cn/",
        purpose: "跟踪汽车产销、出口和行业运行信息",
      },
    ],
    tags: ["新能源汽车", "整车", "出海"],
  },
  {
    key: "company:688981",
    targetType: "company",
    label: "中芯国际",
    scope:
      "晶圆代工与国产半导体供应链样本，研究产能利用、产品组合、资本开支和行业周期。",
    business: ["晶圆代工", "特色工艺平台", "产能建设与工艺研发"],
    drivers: [
      "消费电子、通信、汽车和工业需求",
      "国产设备材料验证与供应保障",
      "行业库存周期、晶圆价格与产能供需",
    ],
    metrics: [
      "产能利用率、晶圆出货和平均售价",
      "收入结构、毛利率和折旧压力",
      "资本开支、月产能与新增产线爬坡",
    ],
    events: [
      "季度业绩指引和产能规划变化",
      "新产线投产、工艺平台验证与客户导入",
      "出口管制、设备供应和行业政策变化",
    ],
    risks: [
      "成熟制程扩产带来的价格压力",
      "设备获取限制与产线爬坡偏差",
      "终端需求复苏不及预期",
    ],
    questions: [
      "产能利用率回升由哪些终端和工艺驱动？",
      "新增折旧与产品组合改善如何共同影响毛利率？",
      "国产供应链验证能否降低扩产约束？",
    ],
    sources: [
      {
        label: "中芯国际投资者关系",
        url: "https://www.smics.com/cn/site/company_financialSummary",
        purpose: "核验财务报告、业绩发布与公司资料",
      },
      regulatorSources.sse,
      {
        label: "工业和信息化部",
        url: "https://www.miit.gov.cn/",
        purpose: "跟踪电子信息制造业和集成电路政策信息",
      },
    ],
    tags: ["半导体", "晶圆代工", "国产化"],
  },
  {
    key: "company:601138",
    targetType: "company",
    label: "工业富联",
    scope:
      "AI 服务器、网络设备与智能制造样本，研究算力需求、产品结构和客户资本开支传导。",
    business: ["云计算与服务器", "通信及网络设备", "精密制造与工业互联网"],
    drivers: [
      "云厂商和平台公司的 AI 资本开支",
      "高速网络、服务器平台升级与产品结构",
      "客户需求、供应链交付与制造效率",
    ],
    metrics: [
      "云计算业务收入和高价值产品占比",
      "毛利率、费用率与经营现金流",
      "客户资本开支、库存和订单交付节奏",
    ],
    events: [
      "AI 服务器平台升级及新品发布",
      "主要客户资本开支与供应链调整",
      "产能扩张、订单变化和战略合作",
    ],
    risks: [
      "客户集中与资本开支波动",
      "产品迭代、供应保障和交付不及预期",
      "收入增长快于利润改善",
    ],
    questions: [
      "AI 相关收入增长如何映射到利润和现金流？",
      "产品组合升级能否持续改善盈利质量？",
      "客户资本开支变化传导到订单需要多久？",
    ],
    sources: [
      {
        label: "工业富联投资者关系",
        url: "https://www.fii-foxconn.com/InvestorRelations",
        purpose: "核验公告、定期报告和投资者交流信息",
      },
      regulatorSources.sse,
      {
        label: "工业和信息化部",
        url: "https://www.miit.gov.cn/",
        purpose: "跟踪通信业、算力设施和制造业政策数据",
      },
    ],
    tags: ["AI算力", "服务器", "智能制造"],
  },
  {
    key: "company:600276",
    targetType: "company",
    label: "恒瑞医药",
    scope:
      "创新药研发与商业化样本，研究管线里程碑、临床价值、授权合作和费用投入。",
    business: ["创新药研发", "药品生产与商业化", "国际合作与许可交易"],
    drivers: [
      "临床数据、注册获批与适应症扩展",
      "医保准入、院内销售和商业化效率",
      "对外授权、海外临床与研发生产率",
    ],
    metrics: [
      "研发投入、管线阶段和关键里程碑",
      "创新药收入、销售费用率和现金流",
      "获批数量、授权首付款及后续里程碑",
    ],
    events: [
      "临床试验结果、申报受理和药品获批",
      "医保目录、集采和支付政策变化",
      "授权合作、终止合作与专利进展",
    ],
    risks: [
      "临床失败、审批延迟或安全性问题",
      "商业化不及预期与价格压力",
      "研发投入回报周期长、合作条款不确定",
    ],
    questions: [
      "关键管线的临床价值与商业空间如何交叉验证？",
      "创新药收入能否覆盖持续增长的研发投入？",
      "国际授权是能力验证还是短期收益贡献？",
    ],
    sources: [
      {
        label: "恒瑞医药投资者关系",
        url: "https://www.hengrui.com/investor",
        purpose: "核验公告、报告、研发与商业化披露",
      },
      regulatorSources.sse,
      {
        label: "国家药监局药审中心",
        url: "https://www.cde.org.cn/",
        purpose: "核验药品受理、审评审批和指导原则",
      },
    ],
    tags: ["创新药", "研发管线", "国际化"],
  },
  {
    key: "company:600519",
    targetType: "company",
    label: "贵州茅台",
    scope:
      "高端白酒品牌与渠道样本，研究需求、批价、渠道结构、现金流及股东回报。",
    business: ["茅台酒", "系列酒", "直营与经销渠道"],
    drivers: [
      "商务与宴席需求、居民消费信心",
      "产品投放、渠道结构和数字化直营",
      "批价库存、品牌稀缺性与提价节奏",
    ],
    metrics: [
      "销量、吨价和产品结构",
      "直销占比、合同负债与渠道库存",
      "毛利率、经营现金流和分红比例",
    ],
    events: [
      "出厂价、投放政策与产品结构调整",
      "渠道改革、经销商变化和市场秩序措施",
      "分红、回购及产能建设进展",
    ],
    risks: [
      "消费需求放缓与批价波动",
      "渠道库存累积或价盘失稳",
      "增长目标与稀缺性维护之间失衡",
    ],
    questions: [
      "收入增长由量、价还是渠道结构驱动？",
      "批价和合同负债是否支持后续报表表现？",
      "现金流与股东回报政策是否保持一致？",
    ],
    sources: [
      {
        label: "贵州茅台投资者关系",
        url: "https://www.moutaichina.com/maotaigf/tzzgx/tzzgx.shtml",
        purpose: "核验公告、定期报告和公司治理资料",
      },
      regulatorSources.sse,
      regulatorSources.stats,
    ],
    tags: ["白酒", "消费", "渠道"],
  },
  {
    key: "company:600036",
    targetType: "company",
    label: "招商银行",
    scope:
      "零售银行与财富管理样本，研究利率、资产负债结构、信用成本和非息收入。",
    business: ["零售金融", "公司金融", "财富管理与资产管理"],
    drivers: [
      "政策利率、存贷款重定价和负债成本",
      "居民财富配置、资本市场和手续费收入",
      "宏观信用周期、房地产与零售资产质量",
    ],
    metrics: [
      "净息差、存贷款增速和存款成本",
      "不良率、关注率、拨备覆盖率和信用成本",
      "非息收入、AUM、资本充足率和分红",
    ],
    events: [
      "LPR、存款利率和监管政策调整",
      "业绩报告中的资产质量与净息差变化",
      "分红、资本工具发行及管理层沟通",
    ],
    risks: [
      "净息差持续收窄",
      "重点领域风险暴露与信用成本上升",
      "财富管理需求和手续费收入承压",
    ],
    questions: [
      "负债成本改善能否抵消资产收益率下行？",
      "先行资产质量指标是否出现趋势变化？",
      "财富管理修复对收入结构贡献有多大？",
    ],
    sources: [
      {
        label: "招商银行投资者关系",
        url: "https://www.cmbchina.com/cmbir/",
        purpose: "核验财务报告、资本与公司治理信息",
      },
      regulatorSources.sse,
      {
        label: "国家金融监督管理总局",
        url: "https://www.nfra.gov.cn/",
        purpose: "跟踪银行业监管政策和运行数据",
      },
    ],
    tags: ["银行", "财富管理", "资产质量"],
  },
  {
    key: "company:601899",
    targetType: "company",
    label: "紫金矿业",
    scope:
      "全球铜金资源开发样本，研究商品价格、矿山产量、成本曲线、项目投产和地缘风险。",
    business: ["铜矿开发", "黄金矿业", "锌锂等资源与冶炼"],
    drivers: [
      "铜金价格、美元利率和全球库存",
      "矿山品位、回收率、成本与产量爬坡",
      "并购扩张、项目建设和海外运营",
    ],
    metrics: [
      "矿产铜金产量、销售价格和单位成本",
      "主要项目建设进度与资本开支",
      "经营现金流、负债率和资源储量变化",
    ],
    events: [
      "矿山投产、扩产、停产或产量指引调整",
      "资源并购、权益变化和储量更新",
      "所在国税制、许可、安全及社区事件",
    ],
    risks: [
      "商品价格下跌与成本通胀",
      "海外政治、税收、社区和安全风险",
      "项目延期、品位偏差或资本开支超支",
    ],
    questions: [
      "产量增长中有多少来自既有矿山改善？",
      "项目投产能否按期转化为自由现金流？",
      "黄金与铜业务如何平衡周期敏感度？",
    ],
    sources: [
      {
        label: "紫金矿业投资者关系",
        url: "https://www.zijinmining.com/investor/",
        purpose: "核验产量、项目、储量及财务披露",
      },
      regulatorSources.sse,
      {
        label: "自然资源部",
        url: "https://www.mnr.gov.cn/",
        purpose: "跟踪矿产资源政策和行业管理信息",
      },
    ],
    tags: ["铜金", "资源品", "海外项目"],
  },
  {
    key: "industry:汽车",
    targetType: "industry",
    label: "汽车",
    scope:
      "申万 2021 一级行业观察，覆盖整车、零部件及汽车服务，重点演示销量、价格与出口链条。",
    business: ["乘用车与商用车", "汽车零部件", "汽车服务与智能化"],
    drivers: [
      "居民需求、以旧换新和车型周期",
      "电动化、智能化与供应链升级",
      "出口需求、海外准入和本地化生产",
    ],
    metrics: [
      "月度产销、库存和出口",
      "新能源渗透率、价格带与促销",
      "行业利润率、原材料与零部件成本",
    ],
    events: [
      "促消费、购置税和以旧换新政策",
      "头部车企价格调整与新品周期",
      "出口关税、海外法规和供应链事件",
    ],
    risks: [
      "价格竞争和产能利用不足",
      "需求透支与渠道库存上升",
      "贸易摩擦和技术安全问题",
    ],
    questions: [
      "销量增长是否伴随行业盈利改善？",
      "新能源渗透率提升由真实需求还是促销驱动？",
      "出口增长的区域与车型结构是否可持续？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "中国汽车工业协会",
        url: "https://www.caam.org.cn/",
        purpose: "跟踪汽车产销、出口与行业运行",
      },
      {
        label: "工业和信息化部",
        url: "https://www.miit.gov.cn/",
        purpose: "跟踪汽车产业政策和运行数据",
      },
    ],
    tags: ["申万一级", "整车", "出口"],
  },
  {
    key: "industry:电子",
    targetType: "industry",
    label: "电子",
    scope:
      "申万 2021 一级行业观察，覆盖半导体、元件、光学光电子与消费电子制造。",
    business: ["半导体", "消费电子与元件", "光学光电子及电子制造"],
    drivers: [
      "终端出货、产品创新和换机周期",
      "AI 硬件、汽车电子和算力需求",
      "库存周期、国产替代与资本开支",
    ],
    metrics: [
      "全球及国内终端出货与库存",
      "半导体销售、晶圆产能利用率和价格",
      "行业营收利润、研发与资本开支",
    ],
    events: [
      "新品发布、客户订单和供应链变化",
      "产能投放、并购与技术验证",
      "出口管制、产业政策和补贴变化",
    ],
    risks: [
      "需求波动与库存去化反复",
      "扩产过快导致价格压力",
      "技术迭代、贸易限制与客户集中",
    ],
    questions: [
      "复苏由补库存还是终端真实需求驱动？",
      "AI 硬件增量能否覆盖传统终端波动？",
      "国产化进展如何反映到收入和盈利？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "工业和信息化部电子信息司",
        url: "https://www.miit.gov.cn/jgsj/dzs/",
        purpose: "跟踪电子信息制造业运行和政策",
      },
      regulatorSources.stats,
    ],
    tags: ["申万一级", "半导体", "AI硬件"],
  },
  {
    key: "industry:计算机",
    targetType: "industry",
    label: "计算机",
    scope:
      "申万 2021 一级行业观察，覆盖软件开发、IT 服务、计算机设备和数字基础设施。",
    business: ["软件产品", "IT 服务与云计算", "计算机设备和数字基础设施"],
    drivers: [
      "政企 IT 支出、云化和国产化",
      "AI 应用落地、算力建设与商业模式",
      "信创周期、订阅化和行业数字化",
    ],
    metrics: [
      "软件业收入利润和合同负债",
      "订单、续费率、人效及经营现金流",
      "算力投资、服务器出货和云资本开支",
    ],
    events: [
      "大模型与软件产品发布、客户中标",
      "数据、人工智能和信创政策",
      "并购、股权激励和商业模式调整",
    ],
    risks: [
      "项目回款慢、收入确认与现金流错配",
      "AI 投入难以形成可持续付费",
      "竞争加剧、人才成本和技术迭代",
    ],
    questions: [
      "AI 投入能否形成可量化订单与续费？",
      "收入增长是否同步改善现金流和人效？",
      "硬件算力与软件应用收益如何分配？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "工业和信息化部运行监测协调局",
        url: "https://www.miit.gov.cn/gxsj/tjfx/rjy/",
        purpose: "跟踪软件业运行统计",
      },
      {
        label: "国家数据局",
        url: "https://www.nda.gov.cn/",
        purpose: "跟踪数据基础制度和数字经济政策",
      },
    ],
    tags: ["申万一级", "AI算力", "数字基础设施"],
  },
  {
    key: "industry:医药生物",
    targetType: "industry",
    label: "医药生物",
    scope: "申万 2021 一级行业观察，覆盖制药、生物制品、医疗器械、服务与流通。",
    business: ["化学药与中药", "生物制品与创新疗法", "器械、服务与流通"],
    drivers: [
      "人口结构、诊疗需求和医保支付",
      "研发创新、临床价值和出海授权",
      "集采、审评审批与医疗服务政策",
    ],
    metrics: [
      "医药制造业收入利润与研发投入",
      "临床、获批、医保和集采进度",
      "院内诊疗、处方与商业化效率",
    ],
    events: [
      "临床数据、药械获批和授权合作",
      "医保目录、集采与支付方式改革",
      "质量、安全、合规和供应事件",
    ],
    risks: [
      "研发失败和估值回撤",
      "价格政策与支付压力",
      "合规、安全和商业化不及预期",
    ],
    questions: [
      "创新投入如何转化为临床和商业价值？",
      "政策变化对不同子行业影响是否分化？",
      "出海交易能否形成持续研发验证？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "国家药品监督管理局",
        url: "https://www.nmpa.gov.cn/",
        purpose: "跟踪药械监管、审批和安全信息",
      },
      {
        label: "国家医疗保障局",
        url: "https://www.nhsa.gov.cn/",
        purpose: "跟踪医保、集采与支付政策",
      },
    ],
    tags: ["申万一级", "创新药", "医药政策"],
  },
  {
    key: "industry:食品饮料",
    targetType: "industry",
    label: "食品饮料",
    scope: "申万 2021 一级行业观察，覆盖白酒、饮料乳品、休闲食品及调味品。",
    business: ["白酒", "饮料与乳品", "食品加工与调味品"],
    drivers: [
      "居民收入、消费信心与场景恢复",
      "品牌力、产品结构和渠道效率",
      "原料成本、库存周期与竞争格局",
    ],
    metrics: [
      "社零、餐饮收入和价格指数",
      "收入量价拆分、毛利率和现金流",
      "渠道库存、合同负债和终端动销",
    ],
    events: [
      "提价、促销和产品升级",
      "渠道改革、库存与经销商政策",
      "食品安全、原料成本和消费政策",
    ],
    risks: [
      "消费需求弱于预期",
      "渠道库存和价格体系失稳",
      "食品安全与品牌声誉事件",
    ],
    questions: [
      "增长来自真实动销还是渠道补库存？",
      "提价能否被需求和产品结构消化？",
      "成本下降是否转化为利润或竞争投入？",
    ],
    sources: [
      regulatorSources.sw,
      regulatorSources.stats,
      {
        label: "国家市场监督管理总局",
        url: "https://www.samr.gov.cn/",
        purpose: "跟踪食品安全、市场监管和消费环境",
      },
    ],
    tags: ["申万一级", "消费", "渠道"],
  },
  {
    key: "industry:银行",
    targetType: "industry",
    label: "银行",
    scope:
      "申万 2021 一级行业观察，研究利率、信用周期、资产负债结构、资本和股东回报。",
    business: ["公司金融", "零售金融", "金融市场与财富管理"],
    drivers: [
      "货币政策、LPR 和存款成本",
      "信贷需求、资产结构与宏观信用周期",
      "资本市场、手续费收入和监管要求",
    ],
    metrics: [
      "净息差、贷款增速和存款结构",
      "不良率、关注率、拨备和信用成本",
      "资本充足率、非息收入和分红",
    ],
    events: [
      "政策利率、存款挂牌利率与监管规则",
      "房地产、地方债和零售信贷风险变化",
      "分红、资本补充和行业并购",
    ],
    risks: [
      "息差下行与有效信贷需求不足",
      "信用风险暴露和拨备压力",
      "资本约束与非息收入波动",
    ],
    questions: [
      "息差压力何时随负债重定价缓解？",
      "哪些资产质量指标最具前瞻性？",
      "高分红能否与资本和增长目标兼容？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "国家金融监督管理总局",
        url: "https://www.nfra.gov.cn/",
        purpose: "跟踪银行业监管指标和政策",
      },
      {
        label: "中国人民银行",
        url: "https://www.pbc.gov.cn/",
        purpose: "跟踪货币政策、利率和金融统计",
      },
    ],
    tags: ["申万一级", "利率", "资产质量"],
  },
  {
    key: "industry:有色金属",
    targetType: "industry",
    label: "有色金属",
    scope:
      "申万 2021 一级行业观察，覆盖工业金属、贵金属、能源金属和金属新材料。",
    business: ["工业金属", "贵金属", "能源金属与新材料"],
    drivers: [
      "全球制造需求、库存和美元利率",
      "矿山供给、冶炼产能与加工费",
      "新能源需求、资源安全与项目周期",
    ],
    metrics: [
      "金属价格、交易所库存和加工费",
      "矿产量、冶炼开工率和单位成本",
      "行业利润、资本开支和项目投产",
    ],
    events: [
      "矿山扰动、罢工与产量指引",
      "收储、出口、环保与资源政策",
      "并购、项目投产和资源量更新",
    ],
    risks: [
      "商品价格和汇率大幅波动",
      "供给恢复快于需求增长",
      "项目执行、环保安全和地缘风险",
    ],
    questions: [
      "价格上涨由需求、供给还是金融属性驱动？",
      "冶炼与矿山利润如何重新分配？",
      "新增项目对中期供给曲线影响多大？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "自然资源部",
        url: "https://www.mnr.gov.cn/",
        purpose: "跟踪矿产资源政策和储量信息",
      },
      {
        label: "上海期货交易所",
        url: "https://www.shfe.com.cn/",
        purpose: "跟踪主要金属期货、库存和交易数据",
      },
    ],
    tags: ["申万一级", "资源品", "铜金"],
  },
  {
    key: "industry:电力设备",
    targetType: "industry",
    label: "电力设备",
    scope:
      "申万 2021 一级行业观察，覆盖电池、光伏、风电、电网设备和其他电源设备。",
    business: ["电池与储能", "光伏和风电", "电网设备及电力电子"],
    drivers: [
      "新能源装机、消纳与电网投资",
      "终端需求、产能周期和产业链价格",
      "技术迭代、海外市场与能源政策",
    ],
    metrics: [
      "光伏风电及储能新增装机",
      "电池、组件等产品价格与排产",
      "行业盈利、库存、资本开支和出口",
    ],
    events: [
      "能源规划、招标和电价机制变化",
      "扩产、减产、技术路线与产品发布",
      "海外关税、准入、安全和贸易政策",
    ],
    risks: [
      "产能过剩和价格竞争",
      "需求、并网消纳或政策节奏不及预期",
      "技术替代、贸易壁垒和质量安全事件",
    ],
    questions: [
      "装机增长能否带来产业链盈利修复？",
      "储能商业模式和安全标准如何演化？",
      "海外需求与贸易限制谁的影响更大？",
    ],
    sources: [
      regulatorSources.sw,
      {
        label: "国家能源局",
        url: "https://www.nea.gov.cn/",
        purpose: "跟踪电力、可再生能源和储能政策数据",
      },
      {
        label: "中国光伏行业协会",
        url: "https://www.chinapv.org.cn/",
        purpose: "跟踪光伏行业运行、技术和产能信息",
      },
    ],
    tags: ["申万一级", "新能源", "储能"],
  },
  {
    key: "watchlist:cross-industry",
    targetType: "watchlist",
    label: "跨行业研究观察池",
    scope:
      "跨成长、消费、金融、周期和红利风格的演示观察池，用于事件敏感度比较而非模拟持仓。",
    business: [
      "新能源：宁德时代、比亚迪、阳光电源",
      "科技医药：中芯国际、工业富联、恒瑞医药",
      "消费金融资源：贵州茅台、招商银行、紫金矿业、中国海油",
    ],
    drivers: [
      "国内增长、利率、消费和产业政策",
      "AI、新能源、医药创新等产业趋势",
      "商品价格、海外需求与地缘贸易环境",
    ],
    metrics: [
      "按成长、周期、红利标签比较收益与波动",
      "比较盈利预期、估值和资金风格变化",
      "观察事件冲击下的相关性、回撤和分散效果",
    ],
    events: [
      "宏观政策、利率和汇率变化",
      "行业政策、技术产品和公司里程碑",
      "商品价格、海外贸易和供应链扰动",
    ],
    risks: [
      "列表并非组合，不能把等权展示理解为配置建议",
      "跨行业相关性会随宏观环境变化",
      "公告事实、研究推断与市场价格反应可能背离",
    ],
    questions: [
      "同一宏观事件对五类风格对象如何差异化传导？",
      "行业分散是否真正降低共同因子暴露？",
      "哪些指标能最早证伪各对象的研究假设？",
    ],
    sources: [
      {
        label: "上交所",
        url: "https://www.sse.com.cn/",
        purpose: "核验沪市证券公告与交易信息",
      },
      {
        label: "深交所",
        url: "https://www.szse.cn/",
        purpose: "核验深市证券公告与交易信息",
      },
      regulatorSources.stats,
    ],
    tags: ["演示", "跨行业", "组合研究"],
  },
];

export type MindMapNode = {
  data: {
    text: string;
    uid: string;
    note?: string;
    tag?: string[];
    hyperlink?: string;
    hyperlinkTitle?: string;
  };
  children?: MindMapNode[];
};

function childNodes(
  key: string,
  branch: string,
  values: string[],
): MindMapNode[] {
  return values.map((text, index) => ({
    data: { text, uid: `${key}:${branch}:${index + 1}` },
  }));
}

export function buildMindMapData(seed: ResearchContentSeed) {
  const branch = (id: string, text: string, values: string[]): MindMapNode => ({
    data: { text, uid: `${seed.key}:${id}`, tag: [text] },
    children: childNodes(seed.key, id, values),
  });
  return {
    root: {
      data: {
        text: `${seed.label}研究框架`,
        uid: `${seed.key}:root`,
        note: seed.scope,
        tag: seed.tags.slice(0, 5),
      },
      children: [
        branch("business", "业务与范围", seed.business),
        branch("drivers", "核心驱动链", seed.drivers),
        branch("metrics", "跟踪指标", seed.metrics),
        branch("events", "事件触发器", seed.events),
        branch("risks", "风险与反证", seed.risks),
        branch("questions", "待验证问题", seed.questions),
        {
          data: { text: "权威来源", uid: `${seed.key}:sources`, tag: ["来源"] },
          children: seed.sources.map((source, index) => ({
            data: {
              text: source.label,
              uid: `${seed.key}:source:${index + 1}`,
              note: source.purpose,
              hyperlink: source.url,
              hyperlinkTitle: source.label,
            },
          })),
        },
      ],
    },
    layout: "mindMap",
    theme: { template: "classicBlue", config: {} },
    view: null,
  };
}

export function buildResearchNoteMarkdown(
  seed: ResearchContentSeed,
  mindMapId: string,
) {
  const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");
  const sources = seed.sources
    .map((source) => `- [${source.label}](${source.url})：${source.purpose}`)
    .join("\n");
  return `## 研究定位\n\n${seed.scope}\n\n> 本笔记用于本机项目演示，不代表实际持仓、收益预测或投资建议。\n\n## 业务与研究范围\n\n${list(seed.business)}\n\n## 核心驱动链\n\n${list(seed.drivers)}\n\n## 跟踪指标\n\n${list(seed.metrics)}\n\n## 事件触发器\n\n${list(seed.events)}\n\n## 风险与反证\n\n${list(seed.risks)}\n\n## 待验证问题\n\n${list(seed.questions)}\n\n## 权威来源入口\n\n${sources}\n\n## 关联思维导图\n\n[打开「${seed.label}研究框架」](/mind-maps/${mindMapId})`;
}

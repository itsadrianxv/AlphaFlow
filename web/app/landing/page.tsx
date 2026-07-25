import type { Metadata } from "next";
import Link from "next/link";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  title: "AlphaFlow | 把研究链路变成可执行决策",
  description:
    "从全市场筛选到公司研究、择时与复盘，AlphaFlow 让每条投资判断都有数据、有证据、可追溯。",
};

const universeRows = [
  { code: "600519", name: "贵州茅台", score: "92", move: "+1.84%" },
  { code: "300750", name: "宁德时代", score: "88", move: "+3.16%" },
  { code: "002594", name: "比亚迪", score: "84", move: "+2.09%" },
  { code: "601318", name: "中国平安", score: "79", move: "+0.76%" },
];

const workflowSteps = [
  ["01", "筛选", "把财务质量、估值与市场信号组合成可复用规则。"],
  ["02", "研究", "沿行业、公司与卖方预期建立带引用的证据链。"],
  ["03", "择时", "结合市场状态、风险条件和持仓上下文形成计划。"],
  ["04", "复盘", "记录假设变化，让下一次决策继承本次研究。"],
] as const;

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function ProductPreview() {
  return (
    <section
      className={styles.productFrame}
      aria-label="AlphaFlow 股票筛选工作台预览"
    >
      <div className={styles.windowBar}>
        <span className={styles.windowDots} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>AlphaFlow / 股票筛选</span>
        <span className={styles.syncState}>数据已更新</span>
      </div>

      <div className={styles.previewBody}>
        <aside className={styles.previewNav}>
          <BrandMark />
          <span className={styles.activeNav}>筛</span>
          <span>研</span>
          <span>时</span>
        </aside>

        <div className={styles.previewMain}>
          <div className={styles.previewHeading}>
            <div>
              <p>策略 / 高质量成长</p>
              <h2>候选池</h2>
            </div>
            <div className={styles.marketStatus}>
              <span /> 沪深市场 · 交易中
            </div>
          </div>

          <div className={styles.filterLine}>
            <span>ROE &gt; 15%</span>
            <span>营收增速 &gt; 20%</span>
            <span>PE 分位 &lt; 60%</span>
            <b>+ 4 条条件</b>
          </div>

          <div className={styles.stockTable}>
            <div className={styles.tableHeader}>
              <span>公司</span>
              <span>综合分</span>
              <span>当日</span>
              <span>趋势</span>
            </div>
            {universeRows.map((stock, index) => (
              <div className={styles.stockRow} key={stock.code}>
                <span className={styles.stockName}>
                  <i>{String(index + 1).padStart(2, "0")}</i>
                  <b>{stock.name}</b>
                  <small>{stock.code}</small>
                </span>
                <strong>{stock.score}</strong>
                <em>{stock.move}</em>
                <span className={styles.spark} aria-hidden="true">
                  <i style={{ height: `${28 + index * 7}%` }} />
                  <i style={{ height: `${48 + index * 4}%` }} />
                  <i style={{ height: `${42 + index * 8}%` }} />
                  <i style={{ height: `${72 - index * 3}%` }} />
                  <i style={{ height: `${64 + index * 6}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>

        <aside className={styles.insightPanel}>
          <div>
            <p>研究进度</p>
            <strong>12 / 16</strong>
          </div>
          <div className={styles.progressTrack}>
            <span />
          </div>
          <div className={styles.insightCopy}>
            <span>系统判断</span>
            <h3>盈利质量仍在改善</h3>
            <p>现金流与利润增速匹配，当前主要分歧来自估值中枢。</p>
          </div>
          <div className={styles.evidenceItem}>
            <span>证据 08</span>
            <p>近四季经营现金流同比增长 26.4%</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link
          className={styles.brand}
          href="/landing"
          aria-label="AlphaFlow 首页"
        >
          <BrandMark />
          <span>AlphaFlow</span>
        </Link>
        <nav aria-label="主导航">
          <a href="#workflow">工作流</a>
          <a href="#research">研究能力</a>
          <Link href="/login">登录</Link>
        </nav>
        <Link className={styles.headerCta} href="/screening">
          打开工作台
          <ArrowIcon />
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroGrid} aria-hidden="true" />
        <div className={styles.heroContent}>
          <h1>
            从全市场噪声中，
            <br />
            找到值得研究的公司。
          </h1>
          <p>
            筛选、行业研究、公司判断与择时不再散落在不同工具里。
            <br className={styles.desktopBreak} />
            AlphaFlow 把每一步压缩成一条可追溯的投资工作流。
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryCta} href="/screening">
              开始筛选
              <ArrowIcon />
            </Link>
            <Link className={styles.secondaryCta} href="/login">
              登录账户
            </Link>
          </div>
          <div className={styles.heroProof}>
            <span>全市场数据</span>
            <span>证据链研究</span>
            <span>策略版本追踪</span>
          </div>
        </div>

        <div className={styles.previewWrap}>
          <ProductPreview />
        </div>
      </section>

      <section className={styles.statement} id="research">
        <p className={styles.sectionNumber}>01 / RESEARCH</p>
        <div>
          <h2>
            不是更多信息。
            <br />
            是更少的盲区。
          </h2>
          <p>
            每个结论都回到数据与原始证据。你能看到判断从哪里来，哪些假设仍未验证，以及何时需要重做研究。
          </p>
        </div>
        <section className={styles.signalStrip} aria-label="研究信号示例">
          <div>
            <span>基本面</span>
            <strong>盈利韧性</strong>
            <b>强</b>
          </div>
          <div>
            <span>估值</span>
            <strong>五年分位</strong>
            <b>43%</b>
          </div>
          <div>
            <span>预期差</span>
            <strong>一致预期上修</strong>
            <b>+6.2%</b>
          </div>
          <div>
            <span>风险</span>
            <strong>关键条件</strong>
            <b>2 项</b>
          </div>
        </section>
      </section>

      <section className={styles.workflow} id="workflow">
        <div className={styles.workflowTitle}>
          <p className={styles.sectionNumber}>02 / WORKFLOW</p>
          <h2>一条链路，完整保留决策上下文。</h2>
        </div>
        <div className={styles.workflowList}>
          {workflowSteps.map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{description}</p>
              <ArrowIcon />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <h2>下一条投资线索，从这里开始。</h2>
          <p>建立你的筛选策略，让研究沿着证据继续。</p>
        </div>
        <Link className={styles.primaryCta} href="/screening">
          进入 AlphaFlow
          <ArrowIcon />
        </Link>
      </section>

      <footer className={styles.footer}>
        <span>AlphaFlow</span>
        <p>Research with evidence. Decide with context.</p>
        <span>© 2026</span>
      </footer>
    </main>
  );
}

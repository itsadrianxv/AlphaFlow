import { StockCode } from "../value-objects/stock-code";
import { IndicatorField, getIndicatorCategory } from "../enums/indicator-field";
import { IndicatorCategory } from "../enums/indicator-category";

/**
 * Stock 实体属性接口
 *
 * 包含股票的基础信息和各类财务指标
 */
export interface StockProps {
  /** 股票代码 */
  code: StockCode;
  /** 股票名称 */
  name: string;
  /** 行业 */
  industry: string;
  /** 板块 */
  sector: string;

  // ========== 财务指标 ==========
  /** 净资产收益率 (ROE) */
  roe?: number | null;
  /** 市盈率 (PE) */
  pe?: number | null;
  /** 市净率 (PB) */
  pb?: number | null;
  /** 每股收益 (EPS) */
  eps?: number | null;
  /** 营业收入（亿元） */
  revenue?: number | null;
  /** 净利润（亿元） */
  netProfit?: number | null;
  /** 资产负债率 */
  debtRatio?: number | null;
  /** 总市值（亿元） */
  marketCap?: number | null;
  /** 流通市值（亿元） */
  floatMarketCap?: number | null;

  /** 数据日期 */
  dataDate?: Date | null;
}

/**
 * Stock 实体
 *
 * 代表一只股票及其相关的基础信息和财务指标。
 * Stock 是领域层的核心实体，用于筛选条件评估和评分计算。
 *
 * 设计原则：
 * - 不可变性：所有属性为只读，通过构造函数初始化
 * - 值对象组合：使用 StockCode 值对象确保代码格式正确
 * - 指标访问：提供 getValue 方法统一访问各类指标
 *
 * @example
 * const stock = new Stock({
 *   code: StockCode.create("600519"),
 *   name: "贵州茅台",
 *   industry: "白酒",
 *   sector: "主板",
 *   roe: 0.28,
 *   pe: 35.5,
 *   pb: 10.2,
 *   marketCap: 21000.0
 * });
 *
 * const roeValue = stock.getValue(IndicatorField.ROE); // 0.28
 * const industryValue = stock.getValue(IndicatorField.INDUSTRY); // "白酒"
 */
export class Stock {
  readonly code: StockCode;
  readonly name: string;
  readonly industry: string;
  readonly sector: string;

  readonly roe: number | null;
  readonly pe: number | null;
  readonly pb: number | null;
  readonly eps: number | null;
  readonly revenue: number | null;
  readonly netProfit: number | null;
  readonly debtRatio: number | null;
  readonly marketCap: number | null;
  readonly floatMarketCap: number | null;

  readonly dataDate: Date | null;

  /**
   * 构造函数
   * @param props 股票属性
   */
  constructor(props: StockProps) {
    this.code = props.code;
    this.name = props.name;
    this.industry = props.industry;
    this.sector = props.sector;

    this.roe = props.roe ?? null;
    this.pe = props.pe ?? null;
    this.pb = props.pb ?? null;
    this.eps = props.eps ?? null;
    this.revenue = props.revenue ?? null;
    this.netProfit = props.netProfit ?? null;
    this.debtRatio = props.debtRatio ?? null;
    this.marketCap = props.marketCap ?? null;
    this.floatMarketCap = props.floatMarketCap ?? null;

    this.dataDate = props.dataDate ?? null;
  }

  /**
   * 获取指定指标的值
   *
   * 根据 IndicatorField 返回对应的指标值。
   * 仅支持 BASIC 类别的指标（直接从 Stock 实体获取）。
   * TIME_SERIES 和 DERIVED 类别的指标需要通过 IIndicatorCalculationService 计算。
   *
   * @param indicator 指标字段
   * @returns 指标值（数值或文本），如果指标不存在或不支持则返回 null
   *
   * @example
   * const roe = stock.getValue(IndicatorField.ROE); // 0.28
   * const industry = stock.getValue(IndicatorField.INDUSTRY); // "白酒"
   * const cagr = stock.getValue(IndicatorField.REVENUE_CAGR_3Y); // null (需要通过服务计算)
   */
  getValue(indicator: IndicatorField): number | string | null {
    // 只处理 BASIC 类别的指标
    const category = getIndicatorCategory(indicator);
    if (category !== IndicatorCategory.BASIC) {
      return null;
    }

    switch (indicator) {
      case IndicatorField.ROE:
        return this.roe;
      case IndicatorField.PE:
        return this.pe;
      case IndicatorField.PB:
        return this.pb;
      case IndicatorField.EPS:
        return this.eps;
      case IndicatorField.REVENUE:
        return this.revenue;
      case IndicatorField.NET_PROFIT:
        return this.netProfit;
      case IndicatorField.DEBT_RATIO:
        return this.debtRatio;
      case IndicatorField.MARKET_CAP:
        return this.marketCap;
      case IndicatorField.FLOAT_MARKET_CAP:
        return this.floatMarketCap;
      case IndicatorField.INDUSTRY:
        return this.industry;
      case IndicatorField.SECTOR:
        return this.sector;
      default:
        return null;
    }
  }

  /**
   * 判断两个 Stock 是否相等（基于股票代码）
   * @param other 另一个 Stock
   * @returns 是否相等
   */
  equals(other: Stock | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this.code.equals(other.code);
  }

  /**
   * 转换为字符串表示
   * @returns 股票的字符串表示
   */
  toString(): string {
    return `${this.code.value} ${this.name}`;
  }

  /**
   * 序列化为普通对象
   * @returns 序列化后的对象
   */
  toDict(): Record<string, unknown> {
    return {
      code: this.code.value,
      name: this.name,
      industry: this.industry,
      sector: this.sector,
      roe: this.roe,
      pe: this.pe,
      pb: this.pb,
      eps: this.eps,
      revenue: this.revenue,
      netProfit: this.netProfit,
      debtRatio: this.debtRatio,
      marketCap: this.marketCap,
      floatMarketCap: this.floatMarketCap,
      dataDate: this.dataDate?.toISOString() ?? null,
    };
  }

  /**
   * 从普通对象反序列化
   * @param data 序列化的对象
   * @returns Stock 实例
   */
  static fromDict(data: Record<string, unknown>): Stock {
    return new Stock({
      code: StockCode.create(data.code as string),
      name: data.name as string,
      industry: data.industry as string,
      sector: data.sector as string,
      roe: data.roe as number | null | undefined,
      pe: data.pe as number | null | undefined,
      pb: data.pb as number | null | undefined,
      eps: data.eps as number | null | undefined,
      revenue: data.revenue as number | null | undefined,
      netProfit: data.netProfit as number | null | undefined,
      debtRatio: data.debtRatio as number | null | undefined,
      marketCap: data.marketCap as number | null | undefined,
      floatMarketCap: data.floatMarketCap as number | null | undefined,
      dataDate: data.dataDate ? new Date(data.dataDate as string) : null,
    });
  }
}

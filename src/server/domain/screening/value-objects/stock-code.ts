/**
 * StockCode 共享内核值对象
 *
 * A 股股票代码规范：
 * - 6 位数字
 * - 以 0、3、6 开头
 *   - 0 开头：深圳主板
 *   - 3 开头：创业板
 *   - 6 开头：上海主板
 *
 * @example
 * const code = StockCode.create("600519"); // 贵州茅台
 * const code2 = StockCode.create("000001"); // 平安银行
 * const code3 = StockCode.create("300750"); // 宁德时代
 */
export class StockCode {
  private readonly _value: string;

  /**
   * 私有构造函数，通过静态工厂方法创建实例
   */
  private constructor(value: string) {
    this._value = value;
  }

  /**
   * 获取股票代码值
   */
  get value(): string {
    return this._value;
  }

  /**
   * 创建 StockCode 实例
   * @param code 股票代码字符串
   * @returns StockCode 实例
   * @throws InvalidStockCodeError 如果代码格式不符合 A 股规范
   */
  static create(code: string): StockCode {
    const validation = StockCode.validate(code);
    if (!validation.isValid) {
      throw new InvalidStockCodeError(code, validation.error!);
    }
    return new StockCode(code);
  }

  /**
   * 尝试创建 StockCode 实例，不抛出异常
   * @param code 股票代码字符串
   * @returns StockCode 实例或 null
   */
  static tryCreate(code: string): StockCode | null {
    const validation = StockCode.validate(code);
    if (!validation.isValid) {
      return null;
    }
    return new StockCode(code);
  }

  /**
   * 验证股票代码格式
   * @param code 股票代码字符串
   * @returns 验证结果
   */
  static validate(code: string): StockCodeValidationResult {
    // 检查是否为空
    if (!code || code.trim() === "") {
      return {
        isValid: false,
        error: "股票代码不能为空",
      };
    }

    // 检查长度
    if (code.length !== 6) {
      return {
        isValid: false,
        error: `股票代码必须为 6 位数字，当前长度为 ${code.length}`,
      };
    }

    // 检查是否全为数字
    if (!/^\d{6}$/.test(code)) {
      return {
        isValid: false,
        error: "股票代码必须全部为数字",
      };
    }

    // 检查开头字符
    const firstChar = code[0];
    if (firstChar !== "0" && firstChar !== "3" && firstChar !== "6") {
      return {
        isValid: false,
        error: `A 股代码必须以 0、3 或 6 开头，当前开头为 ${firstChar}`,
      };
    }

    return { isValid: true };
  }

  /**
   * 判断是否为有效的 A 股代码
   * @param code 股票代码字符串
   * @returns 是否有效
   */
  static isValid(code: string): boolean {
    return StockCode.validate(code).isValid;
  }

  /**
   * 判断两个 StockCode 是否相等
   * @param other 另一个 StockCode
   * @returns 是否相等
   */
  equals(other: StockCode | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._value === other._value;
  }

  /**
   * 转换为字符串
   * @returns 股票代码字符串
   */
  toString(): string {
    return this._value;
  }

  /**
   * 获取股票所属市场
   * @returns 市场名称
   */
  getMarket(): StockMarket {
    const firstChar = this._value[0];
    switch (firstChar) {
      case "6":
        return StockMarket.SHANGHAI;
      case "0":
        return StockMarket.SHENZHEN_MAIN;
      case "3":
        return StockMarket.SHENZHEN_GEM;
      default:
        // 理论上不会到达这里，因为构造时已验证
        throw new Error(`未知的市场代码前缀: ${firstChar}`);
    }
  }

  /**
   * 序列化为 JSON
   */
  toJSON(): string {
    return this._value;
  }

  /**
   * 从 JSON 反序列化
   */
  static fromJSON(json: string): StockCode {
    return StockCode.create(json);
  }
}

/**
 * 股票代码验证结果
 */
export interface StockCodeValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * 股票市场枚举
 */
export enum StockMarket {
  /** 上海主板 */
  SHANGHAI = "SHANGHAI",
  /** 深圳主板 */
  SHENZHEN_MAIN = "SHENZHEN_MAIN",
  /** 创业板 */
  SHENZHEN_GEM = "SHENZHEN_GEM",
}

/**
 * 无效股票代码错误
 */
export class InvalidStockCodeError extends Error {
  readonly code: string;
  readonly reason: string;

  constructor(code: string, reason: string) {
    super(`无效的股票代码 "${code}": ${reason}`);
    this.name = "InvalidStockCodeError";
    this.code = code;
    this.reason = reason;
  }
}

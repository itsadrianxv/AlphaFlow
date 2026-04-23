/**
 * Shared stock code value object for A-share screening.
 *
 * Supported prefixes:
 * - 0: Shenzhen Main Board
 * - 3: ChiNext
 * - 6: Shanghai Main Board
 * - 9: Beijing Exchange codes returned by the market data gateway
 */
export class StockCode {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  get value(): string {
    return this._value;
  }

  static create(code: string): StockCode {
    const validation = StockCode.validate(code);
    if (!validation.isValid) {
      throw new InvalidStockCodeError(
        code,
        validation.error ?? "股票代码校验失败",
      );
    }
    return new StockCode(code);
  }

  static tryCreate(code: string): StockCode | null {
    const validation = StockCode.validate(code);
    if (!validation.isValid) {
      return null;
    }
    return new StockCode(code);
  }

  static validate(code: string): StockCodeValidationResult {
    if (!code || code.trim() === "") {
      return {
        isValid: false,
        error: "股票代码不能为空",
      };
    }

    if (code.length !== 6) {
      return {
        isValid: false,
        error: `股票代码必须为 6 位数字，当前长度为 ${code.length}`,
      };
    }

    if (!/^\d{6}$/.test(code)) {
      return {
        isValid: false,
        error: "股票代码必须全部为数字",
      };
    }

    const firstChar = code[0];
    if (
      firstChar !== "0" &&
      firstChar !== "3" &&
      firstChar !== "6" &&
      firstChar !== "9"
    ) {
      return {
        isValid: false,
        error: `A 股代码必须以 0、3、6 或 9 开头，当前开头为 ${firstChar}`,
      };
    }

    return { isValid: true };
  }

  static isValid(code: string): boolean {
    return StockCode.validate(code).isValid;
  }

  equals(other: StockCode | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }

  getMarket(): StockMarket {
    const firstChar = this._value[0];
    switch (firstChar) {
      case "6":
        return StockMarket.SHANGHAI;
      case "0":
        return StockMarket.SHENZHEN_MAIN;
      case "3":
        return StockMarket.SHENZHEN_GEM;
      case "9":
        return StockMarket.BEIJING;
      default:
        throw new Error(`未知的市场代码前缀: ${firstChar}`);
    }
  }

  toJSON(): string {
    return this._value;
  }

  static fromJSON(json: string): StockCode {
    return StockCode.create(json);
  }
}

export interface StockCodeValidationResult {
  isValid: boolean;
  error?: string;
}

export enum StockMarket {
  SHANGHAI = "SHANGHAI",
  SHENZHEN_MAIN = "SHENZHEN_MAIN",
  SHENZHEN_GEM = "SHENZHEN_GEM",
  BEIJING = "BEIJING",
}

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

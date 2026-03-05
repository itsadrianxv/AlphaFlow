import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  StockCode,
  StockMarket,
  InvalidStockCodeError,
} from "../stock-code";

describe("StockCode", () => {
  describe("create", () => {
    it("应该成功创建以 6 开头的上海主板股票代码", () => {
      const code = StockCode.create("600519");
      expect(code.value).toBe("600519");
      expect(code.toString()).toBe("600519");
      expect(code.getMarket()).toBe(StockMarket.SHANGHAI);
    });

    it("应该成功创建以 0 开头的深圳主板股票代码", () => {
      const code = StockCode.create("000001");
      expect(code.value).toBe("000001");
      expect(code.getMarket()).toBe(StockMarket.SHENZHEN_MAIN);
    });

    it("应该成功创建以 3 开头的创业板股票代码", () => {
      const code = StockCode.create("300750");
      expect(code.value).toBe("300750");
      expect(code.getMarket()).toBe(StockMarket.SHENZHEN_GEM);
    });

    it("应该拒绝空字符串", () => {
      expect(() => StockCode.create("")).toThrow(InvalidStockCodeError);
    });

    it("应该拒绝长度不为 6 的代码", () => {
      expect(() => StockCode.create("60051")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("6005199")).toThrow(InvalidStockCodeError);
    });

    it("应该拒绝包含非数字字符的代码", () => {
      expect(() => StockCode.create("60051a")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("abcdef")).toThrow(InvalidStockCodeError);
    });

    it("应该拒绝不以 0/3/6 开头的代码", () => {
      expect(() => StockCode.create("100001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("200001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("400001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("500001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("700001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("800001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("900001")).toThrow(InvalidStockCodeError);
    });
  });

  describe("tryCreate", () => {
    it("应该对有效代码返回 StockCode 实例", () => {
      const code = StockCode.tryCreate("600519");
      expect(code).not.toBeNull();
      expect(code?.value).toBe("600519");
    });

    it("应该对无效代码返回 null", () => {
      expect(StockCode.tryCreate("")).toBeNull();
      expect(StockCode.tryCreate("12345")).toBeNull();
      expect(StockCode.tryCreate("100001")).toBeNull();
    });
  });

  describe("validate", () => {
    it("应该对有效代码返回 isValid: true", () => {
      expect(StockCode.validate("600519").isValid).toBe(true);
      expect(StockCode.validate("000001").isValid).toBe(true);
      expect(StockCode.validate("300750").isValid).toBe(true);
    });

    it("应该对无效代码返回 isValid: false 和错误信息", () => {
      const result = StockCode.validate("100001");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("0、3 或 6 开头");
    });
  });

  describe("isValid", () => {
    it("应该正确判断代码有效性", () => {
      expect(StockCode.isValid("600519")).toBe(true);
      expect(StockCode.isValid("100001")).toBe(false);
    });
  });

  describe("equals", () => {
    it("应该正确比较两个相同的 StockCode", () => {
      const code1 = StockCode.create("600519");
      const code2 = StockCode.create("600519");
      expect(code1.equals(code2)).toBe(true);
    });

    it("应该正确比较两个不同的 StockCode", () => {
      const code1 = StockCode.create("600519");
      const code2 = StockCode.create("000001");
      expect(code1.equals(code2)).toBe(false);
    });

    it("应该对 null 和 undefined 返回 false", () => {
      const code = StockCode.create("600519");
      expect(code.equals(null)).toBe(false);
      expect(code.equals(undefined)).toBe(false);
    });
  });

  describe("序列化", () => {
    it("toJSON 应该返回代码字符串", () => {
      const code = StockCode.create("600519");
      expect(code.toJSON()).toBe("600519");
    });

    it("fromJSON 应该正确反序列化", () => {
      const code = StockCode.fromJSON("600519");
      expect(code.value).toBe("600519");
    });
  });

  // 属性基测试
  describe("Property-Based Tests", () => {
    /**
     * 生成 5 位数字字符串
     */
    const arbFiveDigits = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 5, maxLength: 5 })
      .map((digits) => digits.join(""));

    /**
     * 生成有效的 A 股代码
     * Feature: stock-screening-platform
     * **Validates: Requirements 5.2**
     */
    const arbValidStockCode = fc
      .tuple(fc.constantFrom("0", "3", "6"), arbFiveDigits)
      .map(([prefix, suffix]) => prefix + suffix);

    /**
     * 生成无效前缀的代码
     */
    const arbInvalidPrefixCode = fc
      .tuple(fc.constantFrom("1", "2", "4", "5", "7", "8", "9"), arbFiveDigits)
      .map(([prefix, suffix]) => prefix + suffix);

    it("对于所有有效的 A 股代码，create 应该成功", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.value === codeStr && code.toString() === codeStr;
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有有效的 A 股代码，validate 应该返回 isValid: true", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          return StockCode.validate(codeStr).isValid === true;
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有无效前缀的代码，create 应该抛出 InvalidStockCodeError", () => {
      fc.assert(
        fc.property(arbInvalidPrefixCode, (codeStr) => {
          try {
            StockCode.create(codeStr);
            return false; // 不应该到达这里
          } catch (e) {
            return e instanceof InvalidStockCodeError;
          }
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有有效代码，equals 应该满足自反性", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.equals(code);
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有有效代码，equals 应该满足对称性", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code1 = StockCode.create(codeStr);
          const code2 = StockCode.create(codeStr);
          return code1.equals(code2) === code2.equals(code1);
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有有效代码，序列化往返应该保持一致", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const original = StockCode.create(codeStr);
          const restored = StockCode.fromJSON(original.toJSON());
          return original.equals(restored);
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有以 6 开头的代码，getMarket 应该返回 SHANGHAI", () => {
      const arbShanghaiCode = arbFiveDigits.map((suffix) => "6" + suffix);

      fc.assert(
        fc.property(arbShanghaiCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHANGHAI;
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有以 0 开头的代码，getMarket 应该返回 SHENZHEN_MAIN", () => {
      const arbShenzhenMainCode = arbFiveDigits.map((suffix) => "0" + suffix);

      fc.assert(
        fc.property(arbShenzhenMainCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHENZHEN_MAIN;
        }),
        { numRuns: 100 }
      );
    });

    it("对于所有以 3 开头的代码，getMarket 应该返回 SHENZHEN_GEM", () => {
      const arbGemCode = arbFiveDigits.map((suffix) => "3" + suffix);

      fc.assert(
        fc.property(arbGemCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHENZHEN_GEM;
        }),
        { numRuns: 100 }
      );
    });
  });
});

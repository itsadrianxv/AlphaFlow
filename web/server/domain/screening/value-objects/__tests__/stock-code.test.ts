import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { InvalidStockCodeError, StockCode, StockMarket } from "../stock-code";

describe("StockCode", () => {
  describe("create", () => {
    it("creates Shanghai main board codes", () => {
      const code = StockCode.create("600519");
      expect(code.value).toBe("600519");
      expect(code.toString()).toBe("600519");
      expect(code.getMarket()).toBe(StockMarket.SHANGHAI);
    });

    it("creates Shenzhen main board codes", () => {
      const code = StockCode.create("000001");
      expect(code.value).toBe("000001");
      expect(code.getMarket()).toBe(StockMarket.SHENZHEN_MAIN);
    });

    it("creates ChiNext codes", () => {
      const code = StockCode.create("300750");
      expect(code.value).toBe("300750");
      expect(code.getMarket()).toBe(StockMarket.SHENZHEN_GEM);
    });

    it("creates Beijing exchange codes", () => {
      const code = StockCode.create("920000");
      expect(code.value).toBe("920000");
      expect(code.getMarket()).toBe(StockMarket.BEIJING);
    });

    it("rejects empty strings", () => {
      expect(() => StockCode.create("")).toThrow(InvalidStockCodeError);
    });

    it("rejects codes that are not 6 digits long", () => {
      expect(() => StockCode.create("60051")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("6005199")).toThrow(InvalidStockCodeError);
    });

    it("rejects non-numeric codes", () => {
      expect(() => StockCode.create("60051a")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("abcdef")).toThrow(InvalidStockCodeError);
    });

    it("rejects unsupported prefixes", () => {
      expect(() => StockCode.create("100001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("200001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("400001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("500001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("700001")).toThrow(InvalidStockCodeError);
      expect(() => StockCode.create("800001")).toThrow(InvalidStockCodeError);
    });
  });

  describe("tryCreate", () => {
    it("returns a StockCode instance for valid codes", () => {
      const code = StockCode.tryCreate("600519");
      expect(code).not.toBeNull();
      expect(code?.value).toBe("600519");
    });

    it("returns null for invalid codes", () => {
      expect(StockCode.tryCreate("")).toBeNull();
      expect(StockCode.tryCreate("12345")).toBeNull();
      expect(StockCode.tryCreate("100001")).toBeNull();
    });
  });

  describe("validate", () => {
    it("returns isValid=true for supported prefixes", () => {
      expect(StockCode.validate("600519").isValid).toBe(true);
      expect(StockCode.validate("000001").isValid).toBe(true);
      expect(StockCode.validate("300750").isValid).toBe(true);
      expect(StockCode.validate("920000").isValid).toBe(true);
    });

    it("returns an error message for invalid codes", () => {
      const result = StockCode.validate("100001");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("0、3、6 或 9");
    });
  });

  describe("isValid", () => {
    it("reports validity correctly", () => {
      expect(StockCode.isValid("600519")).toBe(true);
      expect(StockCode.isValid("920000")).toBe(true);
      expect(StockCode.isValid("100001")).toBe(false);
    });
  });

  describe("equals", () => {
    it("compares equal codes correctly", () => {
      const code1 = StockCode.create("600519");
      const code2 = StockCode.create("600519");
      expect(code1.equals(code2)).toBe(true);
    });

    it("compares different codes correctly", () => {
      const code1 = StockCode.create("600519");
      const code2 = StockCode.create("000001");
      expect(code1.equals(code2)).toBe(false);
    });

    it("returns false for nullish values", () => {
      const code = StockCode.create("600519");
      expect(code.equals(null)).toBe(false);
      expect(code.equals(undefined)).toBe(false);
    });
  });

  describe("serialization", () => {
    it("serializes to JSON", () => {
      const code = StockCode.create("600519");
      expect(code.toJSON()).toBe("600519");
    });

    it("deserializes from JSON", () => {
      const code = StockCode.fromJSON("600519");
      expect(code.value).toBe("600519");
    });
  });

  describe("property-based behavior", () => {
    const arbFiveDigits = fc
      .array(fc.integer({ min: 0, max: 9 }), { minLength: 5, maxLength: 5 })
      .map((digits) => digits.join(""));

    const arbValidStockCode = fc
      .tuple(fc.constantFrom("0", "3", "6", "9"), arbFiveDigits)
      .map(([prefix, suffix]) => prefix + suffix);

    const arbInvalidPrefixCode = fc
      .tuple(fc.constantFrom("1", "2", "4", "5", "7", "8"), arbFiveDigits)
      .map(([prefix, suffix]) => prefix + suffix);

    it("creates every generated valid stock code", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.value === codeStr && code.toString() === codeStr;
        }),
        { numRuns: 100 },
      );
    });

    it("validates every generated valid stock code", () => {
      fc.assert(
        fc.property(
          arbValidStockCode,
          (codeStr) => StockCode.validate(codeStr).isValid === true,
        ),
        { numRuns: 100 },
      );
    });

    it("rejects every generated invalid prefix", () => {
      fc.assert(
        fc.property(arbInvalidPrefixCode, (codeStr) => {
          try {
            StockCode.create(codeStr);
            return false;
          } catch (error) {
            return error instanceof InvalidStockCodeError;
          }
        }),
        { numRuns: 100 },
      );
    });

    it("keeps equals reflexive", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.equals(code);
        }),
        { numRuns: 100 },
      );
    });

    it("keeps equals symmetric", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const code1 = StockCode.create(codeStr);
          const code2 = StockCode.create(codeStr);
          return code1.equals(code2) === code2.equals(code1);
        }),
        { numRuns: 100 },
      );
    });

    it("round-trips through JSON", () => {
      fc.assert(
        fc.property(arbValidStockCode, (codeStr) => {
          const original = StockCode.create(codeStr);
          const restored = StockCode.fromJSON(original.toJSON());
          return original.equals(restored);
        }),
        { numRuns: 100 },
      );
    });

    it("maps 6-prefixed codes to SHANGHAI", () => {
      const arbShanghaiCode = arbFiveDigits.map((suffix) => `6${suffix}`);

      fc.assert(
        fc.property(arbShanghaiCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHANGHAI;
        }),
        { numRuns: 100 },
      );
    });

    it("maps 0-prefixed codes to SHENZHEN_MAIN", () => {
      const arbShenzhenMainCode = arbFiveDigits.map((suffix) => `0${suffix}`);

      fc.assert(
        fc.property(arbShenzhenMainCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHENZHEN_MAIN;
        }),
        { numRuns: 100 },
      );
    });

    it("maps 3-prefixed codes to SHENZHEN_GEM", () => {
      const arbGemCode = arbFiveDigits.map((suffix) => `3${suffix}`);

      fc.assert(
        fc.property(arbGemCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.SHENZHEN_GEM;
        }),
        { numRuns: 100 },
      );
    });

    it("maps 9-prefixed codes to BEIJING", () => {
      const arbBeijingCode = arbFiveDigits.map((suffix) => `9${suffix}`);

      fc.assert(
        fc.property(arbBeijingCode, (codeStr) => {
          const code = StockCode.create(codeStr);
          return code.getMarket() === StockMarket.BEIJING;
        }),
        { numRuns: 100 },
      );
    });
  });
});

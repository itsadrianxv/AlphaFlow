import { describe, it, expect } from "vitest";
import {
  type IndicatorValue,
  type NumericValue,
  type TextValue,
  type ListValue,
  type RangeValue,
  type TimeSeriesValue,
  isNumericValue,
  isTextValue,
  isListValue,
  isRangeValue,
  isTimeSeriesValue,
  createNumericValue,
  createTextValue,
  createListValue,
  createRangeValue,
  createTimeSeriesValue,
  indicatorValueToDict,
  indicatorValueFromDict,
  indicatorValueEquals,
} from "../indicator-value";

describe("IndicatorValue Tagged Union", () => {
  describe("Type Guards", () => {
    it("isNumericValue should correctly identify NumericValue", () => {
      const numericValue: IndicatorValue = { type: "numeric", value: 0.15 };
      const textValue: IndicatorValue = { type: "text", value: "白酒" };

      expect(isNumericValue(numericValue)).toBe(true);
      expect(isNumericValue(textValue)).toBe(false);
    });

    it("isTextValue should correctly identify TextValue", () => {
      const textValue: IndicatorValue = { type: "text", value: "白酒" };
      const numericValue: IndicatorValue = { type: "numeric", value: 0.15 };

      expect(isTextValue(textValue)).toBe(true);
      expect(isTextValue(numericValue)).toBe(false);
    });

    it("isListValue should correctly identify ListValue", () => {
      const listValue: IndicatorValue = {
        type: "list",
        values: ["白酒", "医药"],
      };
      const textValue: IndicatorValue = { type: "text", value: "白酒" };

      expect(isListValue(listValue)).toBe(true);
      expect(isListValue(textValue)).toBe(false);
    });

    it("isRangeValue should correctly identify RangeValue", () => {
      const rangeValue: IndicatorValue = { type: "range", min: 10, max: 30 };
      const numericValue: IndicatorValue = { type: "numeric", value: 20 };

      expect(isRangeValue(rangeValue)).toBe(true);
      expect(isRangeValue(numericValue)).toBe(false);
    });

    it("isTimeSeriesValue should correctly identify TimeSeriesValue", () => {
      const timeSeriesValue: IndicatorValue = { type: "timeSeries", years: 3 };
      const numericValue: IndicatorValue = { type: "numeric", value: 0.15 };

      expect(isTimeSeriesValue(timeSeriesValue)).toBe(true);
      expect(isTimeSeriesValue(numericValue)).toBe(false);
    });

    it("type guards should work with type narrowing", () => {
      const value: IndicatorValue = { type: "numeric", value: 0.15, unit: "%" };

      if (isNumericValue(value)) {
        // TypeScript should narrow the type here
        expect(value.value).toBe(0.15);
        expect(value.unit).toBe("%");
      }
    });
  });

  describe("Factory Functions", () => {
    it("createNumericValue should create NumericValue correctly", () => {
      const value = createNumericValue(0.15, "%");

      expect(value.type).toBe("numeric");
      expect(value.value).toBe(0.15);
      expect(value.unit).toBe("%");
    });

    it("createNumericValue should work without unit", () => {
      const value = createNumericValue(35.5);

      expect(value.type).toBe("numeric");
      expect(value.value).toBe(35.5);
      expect(value.unit).toBeUndefined();
    });

    it("createTextValue should create TextValue correctly", () => {
      const value = createTextValue("白酒");

      expect(value.type).toBe("text");
      expect(value.value).toBe("白酒");
    });

    it("createListValue should create ListValue correctly", () => {
      const value = createListValue(["白酒", "医药", "银行"]);

      expect(value.type).toBe("list");
      expect(value.values).toEqual(["白酒", "医药", "银行"]);
    });

    it("createListValue should create a copy of the input array", () => {
      const input = ["白酒", "医药"];
      const value = createListValue(input);

      input.push("银行");
      expect(value.values).toEqual(["白酒", "医药"]);
    });

    it("createRangeValue should create RangeValue correctly", () => {
      const value = createRangeValue(10, 30);

      expect(value.type).toBe("range");
      expect(value.min).toBe(10);
      expect(value.max).toBe(30);
    });

    it("createRangeValue should throw when min > max", () => {
      expect(() => createRangeValue(30, 10)).toThrow(
        "范围值无效：min (30) 不能大于 max (10)"
      );
    });

    it("createRangeValue should allow min === max", () => {
      const value = createRangeValue(20, 20);

      expect(value.min).toBe(20);
      expect(value.max).toBe(20);
    });

    it("createTimeSeriesValue should create TimeSeriesValue correctly", () => {
      const value = createTimeSeriesValue(3, 0.1);

      expect(value.type).toBe("timeSeries");
      expect(value.years).toBe(3);
      expect(value.threshold).toBe(0.1);
    });

    it("createTimeSeriesValue should work without threshold", () => {
      const value = createTimeSeriesValue(5);

      expect(value.type).toBe("timeSeries");
      expect(value.years).toBe(5);
      expect(value.threshold).toBeUndefined();
    });

    it("createTimeSeriesValue should throw when years <= 0", () => {
      expect(() => createTimeSeriesValue(0)).toThrow(
        "时间序列年数必须大于 0，当前值为 0"
      );
      expect(() => createTimeSeriesValue(-1)).toThrow(
        "时间序列年数必须大于 0，当前值为 -1"
      );
    });
  });

  describe("Serialization", () => {
    describe("indicatorValueToDict", () => {
      it("should serialize NumericValue correctly", () => {
        const value: NumericValue = { type: "numeric", value: 0.15, unit: "%" };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "numeric", value: 0.15, unit: "%" });
      });

      it("should serialize NumericValue without unit", () => {
        const value: NumericValue = { type: "numeric", value: 35.5 };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "numeric", value: 35.5 });
        expect(dict).not.toHaveProperty("unit");
      });

      it("should serialize TextValue correctly", () => {
        const value: TextValue = { type: "text", value: "白酒" };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "text", value: "白酒" });
      });

      it("should serialize ListValue correctly", () => {
        const value: ListValue = { type: "list", values: ["白酒", "医药"] };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "list", values: ["白酒", "医药"] });
      });

      it("should serialize RangeValue correctly", () => {
        const value: RangeValue = { type: "range", min: 10, max: 30 };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "range", min: 10, max: 30 });
      });

      it("should serialize TimeSeriesValue correctly", () => {
        const value: TimeSeriesValue = {
          type: "timeSeries",
          years: 3,
          threshold: 0.1,
        };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "timeSeries", years: 3, threshold: 0.1 });
      });

      it("should serialize TimeSeriesValue without threshold", () => {
        const value: TimeSeriesValue = { type: "timeSeries", years: 5 };
        const dict = indicatorValueToDict(value);

        expect(dict).toEqual({ type: "timeSeries", years: 5 });
        expect(dict).not.toHaveProperty("threshold");
      });
    });

    describe("indicatorValueFromDict", () => {
      it("should deserialize NumericValue correctly", () => {
        const dict = { type: "numeric", value: 0.15, unit: "%" };
        const value = indicatorValueFromDict(dict);

        expect(isNumericValue(value)).toBe(true);
        expect((value as NumericValue).value).toBe(0.15);
        expect((value as NumericValue).unit).toBe("%");
      });

      it("should deserialize TextValue correctly", () => {
        const dict = { type: "text", value: "白酒" };
        const value = indicatorValueFromDict(dict);

        expect(isTextValue(value)).toBe(true);
        expect((value as TextValue).value).toBe("白酒");
      });

      it("should deserialize ListValue correctly", () => {
        const dict = { type: "list", values: ["白酒", "医药"] };
        const value = indicatorValueFromDict(dict);

        expect(isListValue(value)).toBe(true);
        expect((value as ListValue).values).toEqual(["白酒", "医药"]);
      });

      it("should deserialize RangeValue correctly", () => {
        const dict = { type: "range", min: 10, max: 30 };
        const value = indicatorValueFromDict(dict);

        expect(isRangeValue(value)).toBe(true);
        expect((value as RangeValue).min).toBe(10);
        expect((value as RangeValue).max).toBe(30);
      });

      it("should deserialize TimeSeriesValue correctly", () => {
        const dict = { type: "timeSeries", years: 3, threshold: 0.1 };
        const value = indicatorValueFromDict(dict);

        expect(isTimeSeriesValue(value)).toBe(true);
        expect((value as TimeSeriesValue).years).toBe(3);
        expect((value as TimeSeriesValue).threshold).toBe(0.1);
      });

      it("should throw for unknown type", () => {
        const dict = { type: "unknown", value: 123 };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "未知的 IndicatorValue 类型: unknown"
        );
      });

      it("should throw for invalid NumericValue", () => {
        const dict = { type: "numeric", value: "not a number" };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "NumericValue 的 value 必须为数字"
        );
      });

      it("should throw for invalid TextValue", () => {
        const dict = { type: "text", value: 123 };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "TextValue 的 value 必须为字符串"
        );
      });

      it("should throw for invalid ListValue", () => {
        const dict = { type: "list", values: "not an array" };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "ListValue 的 values 必须为数组"
        );
      });

      it("should throw for invalid RangeValue", () => {
        const dict = { type: "range", min: "10", max: 30 };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "RangeValue 的 min 和 max 必须为数字"
        );
      });

      it("should throw for invalid TimeSeriesValue", () => {
        const dict = { type: "timeSeries", years: "3" };

        expect(() => indicatorValueFromDict(dict)).toThrow(
          "TimeSeriesValue 的 years 必须为数字"
        );
      });
    });

    describe("Round-trip serialization", () => {
      it("should preserve NumericValue through serialization", () => {
        const original = createNumericValue(0.15, "%");
        const restored = indicatorValueFromDict(indicatorValueToDict(original));

        expect(indicatorValueEquals(original, restored)).toBe(true);
      });

      it("should preserve TextValue through serialization", () => {
        const original = createTextValue("白酒");
        const restored = indicatorValueFromDict(indicatorValueToDict(original));

        expect(indicatorValueEquals(original, restored)).toBe(true);
      });

      it("should preserve ListValue through serialization", () => {
        const original = createListValue(["白酒", "医药", "银行"]);
        const restored = indicatorValueFromDict(indicatorValueToDict(original));

        expect(indicatorValueEquals(original, restored)).toBe(true);
      });

      it("should preserve RangeValue through serialization", () => {
        const original = createRangeValue(10, 30);
        const restored = indicatorValueFromDict(indicatorValueToDict(original));

        expect(indicatorValueEquals(original, restored)).toBe(true);
      });

      it("should preserve TimeSeriesValue through serialization", () => {
        const original = createTimeSeriesValue(3, 0.1);
        const restored = indicatorValueFromDict(indicatorValueToDict(original));

        expect(indicatorValueEquals(original, restored)).toBe(true);
      });
    });
  });

  describe("indicatorValueEquals", () => {
    it("should return false for different types", () => {
      const numeric: IndicatorValue = { type: "numeric", value: 15 };
      const text: IndicatorValue = { type: "text", value: "15" };

      expect(indicatorValueEquals(numeric, text)).toBe(false);
    });

    it("should compare NumericValue correctly", () => {
      const a: IndicatorValue = { type: "numeric", value: 0.15, unit: "%" };
      const b: IndicatorValue = { type: "numeric", value: 0.15, unit: "%" };
      const c: IndicatorValue = { type: "numeric", value: 0.15 };
      const d: IndicatorValue = { type: "numeric", value: 0.20, unit: "%" };

      expect(indicatorValueEquals(a, b)).toBe(true);
      expect(indicatorValueEquals(a, c)).toBe(false); // different unit
      expect(indicatorValueEquals(a, d)).toBe(false); // different value
    });

    it("should compare TextValue correctly", () => {
      const a: IndicatorValue = { type: "text", value: "白酒" };
      const b: IndicatorValue = { type: "text", value: "白酒" };
      const c: IndicatorValue = { type: "text", value: "医药" };

      expect(indicatorValueEquals(a, b)).toBe(true);
      expect(indicatorValueEquals(a, c)).toBe(false);
    });

    it("should compare ListValue correctly", () => {
      const a: IndicatorValue = { type: "list", values: ["白酒", "医药"] };
      const b: IndicatorValue = { type: "list", values: ["白酒", "医药"] };
      const c: IndicatorValue = { type: "list", values: ["医药", "白酒"] };
      const d: IndicatorValue = { type: "list", values: ["白酒"] };

      expect(indicatorValueEquals(a, b)).toBe(true);
      expect(indicatorValueEquals(a, c)).toBe(false); // different order
      expect(indicatorValueEquals(a, d)).toBe(false); // different length
    });

    it("should compare RangeValue correctly", () => {
      const a: IndicatorValue = { type: "range", min: 10, max: 30 };
      const b: IndicatorValue = { type: "range", min: 10, max: 30 };
      const c: IndicatorValue = { type: "range", min: 10, max: 40 };

      expect(indicatorValueEquals(a, b)).toBe(true);
      expect(indicatorValueEquals(a, c)).toBe(false);
    });

    it("should compare TimeSeriesValue correctly", () => {
      const a: IndicatorValue = { type: "timeSeries", years: 3, threshold: 0.1 };
      const b: IndicatorValue = { type: "timeSeries", years: 3, threshold: 0.1 };
      const c: IndicatorValue = { type: "timeSeries", years: 3 };
      const d: IndicatorValue = { type: "timeSeries", years: 5, threshold: 0.1 };

      expect(indicatorValueEquals(a, b)).toBe(true);
      expect(indicatorValueEquals(a, c)).toBe(false); // different threshold
      expect(indicatorValueEquals(a, d)).toBe(false); // different years
    });
  });
});

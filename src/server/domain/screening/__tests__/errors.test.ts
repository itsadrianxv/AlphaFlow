import { describe, it, expect } from "vitest";
import {
  InvalidStrategyError,
  DuplicateStockError,
  StockNotFoundError,
  InvalidFilterConditionError,
  ScoringError,
  IndicatorCalculationError,
  DataNotAvailableError,
} from "../errors";

describe("Domain Errors", () => {
  describe("InvalidStrategyError", () => {
    it("应该正确创建异常实例", () => {
      const error = new InvalidStrategyError("策略名称不能为空");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidStrategyError);
      expect(error.name).toBe("InvalidStrategyError");
      expect(error.message).toBe("策略名称不能为空");
    });

    it("应该支持 instanceof 检查", () => {
      const error = new InvalidStrategyError("测试错误");
      expect(error instanceof Error).toBe(true);
      expect(error instanceof InvalidStrategyError).toBe(true);
    });
  });

  describe("DuplicateStockError", () => {
    it("应该正确创建异常实例并包含股票代码", () => {
      const error = new DuplicateStockError("600519");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DuplicateStockError);
      expect(error.name).toBe("DuplicateStockError");
      expect(error.message).toBe("股票 600519 已存在于自选股列表中");
    });

    it("应该支持不同的股票代码", () => {
      const error1 = new DuplicateStockError("000001");
      const error2 = new DuplicateStockError("300750");
      expect(error1.message).toContain("000001");
      expect(error2.message).toContain("300750");
    });
  });

  describe("StockNotFoundError", () => {
    it("应该正确创建异常实例并包含股票代码", () => {
      const error = new StockNotFoundError("600519");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(StockNotFoundError);
      expect(error.name).toBe("StockNotFoundError");
      expect(error.message).toBe("股票 600519 未找到");
    });

    it("应该支持不同的股票代码", () => {
      const error1 = new StockNotFoundError("000001");
      const error2 = new StockNotFoundError("300750");
      expect(error1.message).toContain("000001");
      expect(error2.message).toContain("300750");
    });
  });

  describe("InvalidFilterConditionError", () => {
    it("应该正确创建异常实例", () => {
      const error = new InvalidFilterConditionError(
        "IndicatorField 与 IndicatorValue 类型不匹配"
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidFilterConditionError);
      expect(error.name).toBe("InvalidFilterConditionError");
      expect(error.message).toBe(
        "IndicatorField 与 IndicatorValue 类型不匹配"
      );
    });

    it("应该支持自定义错误消息", () => {
      const error = new InvalidFilterConditionError(
        "ComparisonOperator 与 IndicatorValue 类型不兼容"
      );
      expect(error.message).toBe(
        "ComparisonOperator 与 IndicatorValue 类型不兼容"
      );
    });
  });

  describe("ScoringError", () => {
    it("应该正确创建异常实例", () => {
      const error = new ScoringError("所有股票的 ROE 指标均为 null");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ScoringError);
      expect(error.name).toBe("ScoringError");
      expect(error.message).toBe("所有股票的 ROE 指标均为 null");
    });

    it("应该支持不同的错误场景", () => {
      const error1 = new ScoringError("归一化计算失败: min === max");
      const error2 = new ScoringError("评分配置无效");
      expect(error1.message).toContain("归一化");
      expect(error2.message).toContain("配置无效");
    });
  });

  describe("IndicatorCalculationError", () => {
    it("应该正确创建异常实例并包含指标名称和原因", () => {
      const error = new IndicatorCalculationError("ROE", "除零错误");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(IndicatorCalculationError);
      expect(error.name).toBe("IndicatorCalculationError");
      expect(error.message).toBe("指标 ROE 计算失败: 除零错误");
    });

    it("应该支持不同的指标和原因", () => {
      const error1 = new IndicatorCalculationError("PE", "必需数据缺失");
      const error2 = new IndicatorCalculationError(
        "REVENUE_CAGR_3Y",
        "历史数据不足"
      );
      expect(error1.message).toContain("PE");
      expect(error1.message).toContain("必需数据缺失");
      expect(error2.message).toContain("REVENUE_CAGR_3Y");
      expect(error2.message).toContain("历史数据不足");
    });
  });

  describe("DataNotAvailableError", () => {
    it("应该正确创建基本异常实例", () => {
      const error = new DataNotAvailableError("Python 数据服务超时");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DataNotAvailableError);
      expect(error.name).toBe("DataNotAvailableError");
      expect(error.message).toBe("Python 数据服务超时");
      expect(error.statusCode).toBeUndefined();
      expect(error.details).toBeUndefined();
    });

    it("应该支持包含 HTTP 状态码", () => {
      const error = new DataNotAvailableError(
        "Python 数据服务返回错误",
        500
      );
      expect(error.message).toBe("Python 数据服务返回错误");
      expect(error.statusCode).toBe(500);
    });

    it("应该支持包含详细错误信息", () => {
      const details = {
        service: "python-data-service",
        endpoint: "/stocks/codes",
        timestamp: "2024-01-15T10:00:00Z",
      };
      const error = new DataNotAvailableError(
        "外部数据源不可用",
        503,
        details
      );
      expect(error.message).toBe("外部数据源不可用");
      expect(error.statusCode).toBe(503);
      expect(error.details).toEqual(details);
    });

    it("应该支持不同的错误场景", () => {
      const error1 = new DataNotAvailableError("网络连接失败", 0);
      const error2 = new DataNotAvailableError(
        "AkShare 数据源不可用",
        502,
        { upstream: "akshare" }
      );
      expect(error1.message).toContain("网络连接失败");
      expect(error1.statusCode).toBe(0);
      expect(error2.message).toContain("AkShare");
      expect(error2.statusCode).toBe(502);
      expect(error2.details).toHaveProperty("upstream");
    });
  });

  describe("异常继承关系", () => {
    it("所有领域异常都应该继承自 Error", () => {
      const errors = [
        new InvalidStrategyError("test"),
        new DuplicateStockError("600519"),
        new StockNotFoundError("600519"),
        new InvalidFilterConditionError("test"),
        new ScoringError("test"),
        new IndicatorCalculationError("ROE", "test"),
        new DataNotAvailableError("test"),
      ];

      errors.forEach((error) => {
        expect(error instanceof Error).toBe(true);
      });
    });

    it("异常应该可以被 try-catch 捕获", () => {
      const throwError = () => {
        throw new InvalidStrategyError("测试错误");
      };

      expect(throwError).toThrow(InvalidStrategyError);
      expect(throwError).toThrow("测试错误");

      try {
        throwError();
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidStrategyError);
        expect((e as InvalidStrategyError).message).toBe("测试错误");
      }
    });

    it("应该能够区分不同的异常类型", () => {
      const error1 = new InvalidStrategyError("test");
      const error2 = new DuplicateStockError("600519");

      expect(error1 instanceof InvalidStrategyError).toBe(true);
      expect(error1 instanceof DuplicateStockError).toBe(false);
      expect(error2 instanceof DuplicateStockError).toBe(true);
      expect(error2 instanceof InvalidStrategyError).toBe(false);
    });
  });
});

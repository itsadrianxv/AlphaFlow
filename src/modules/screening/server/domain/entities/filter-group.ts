/**
 * FilterGroup 实体
 *
 * 代表支持 AND/OR/NOT 递归嵌套的筛选条件组。
 * FilterGroup 是筛选逻辑的核心组件，通过递归结构支持复杂的条件组合。
 *
 * 设计原则：
 * - 递归结构：支持任意深度的条件组嵌套
 * - 逻辑运算符：AND（全匹配）、OR（任一匹配）、NOT（取反）
 * - NOT 约束：NOT 组仅允许一个子元素
 * - 不可变性：所有属性为只读
 *
 * Requirements: 2.1, 2.4, 2.5
 *
 * @example
 * // 创建简单条件组：ROE > 15% AND PE < 30
 * const group = FilterGroup.create(
 *   LogicalOperator.AND,
 *   [condition1, condition2],
 *   []
 * );
 *
 * // 创建嵌套条件组：(ROE > 15% OR PE < 30) AND 行业 IN [白酒, 医药]
 * const nestedGroup = FilterGroup.create(
 *   LogicalOperator.AND,
 *   [industryCondition],
 *   [subGroup]
 * );
 *
 * // 评估股票是否匹配
 * const matches = group.match(stock, calcService);
 */

import { v4 as uuidv4 } from "uuid";
import { LogicalOperator } from "../enums/logical-operator";
import { InvalidFilterConditionError } from "../errors";
import {
  FilterCondition,
  type IIndicatorCalculationService,
} from "../value-objects/filter-condition";
import type { Stock } from "./stock";

/**
 * FilterGroup 实体属性接口
 */
export interface FilterGroupProps {
  /** 唯一标识符 */
  groupId: string;
  /** 逻辑运算符 */
  operator: LogicalOperator;
  /** 直接包含的筛选条件 */
  conditions: FilterCondition[];
  /** 嵌套的子条件组 */
  subGroups: FilterGroup[];
}

/**
 * FilterGroup 实体
 */
export class FilterGroup {
  readonly groupId: string;
  readonly operator: LogicalOperator;
  readonly conditions: FilterCondition[];
  readonly subGroups: FilterGroup[];

  /**
   * 私有构造函数，使用静态工厂方法 create 创建实例
   */
  private constructor(props: FilterGroupProps) {
    this.groupId = props.groupId;
    this.operator = props.operator;
    this.conditions = props.conditions;
    this.subGroups = props.subGroups;
  }

  /**
   * 创建 FilterGroup 实例
   *
   * @param operator 逻辑运算符
   * @param conditions 筛选条件数组
   * @param subGroups 子条件组数组
   * @param groupId 可选的组 ID（用于反序列化）
   * @returns FilterGroup 实例
   * @throws InvalidFilterConditionError 如果 NOT 组包含多个子元素
   *
   * Requirements: 2.4
   */
  static create(
    operator: LogicalOperator,
    conditions: FilterCondition[] = [],
    subGroups: FilterGroup[] = [],
    groupId?: string,
  ): FilterGroup {
    const id = groupId ?? uuidv4();

    // 验证 NOT 组约束：仅允许一个子元素
    if (operator === LogicalOperator.NOT) {
      const totalElements = conditions.length + subGroups.length;
      if (totalElements !== 1) {
        throw new InvalidFilterConditionError(
          `NOT 组仅允许包含一个子元素（条件或子组），但提供了 ${totalElements} 个元素`,
        );
      }
    }

    return new FilterGroup({
      groupId: id,
      operator,
      conditions,
      subGroups,
    });
  }

  /**
   * 递归匹配股票是否满足此条件组
   *
   * 匹配规则：
   * - AND：所有子条件和子组都匹配时返回 true
   * - OR：至少一个子条件或子组匹配时返回 true
   * - NOT：对唯一子元素的匹配结果取反
   *
   * @param stock 股票实体
   * @param calcService 指标计算服务
   * @returns 是否匹配
   *
   * Requirements: 2.1
   */
  match(stock: Stock, calcService: IIndicatorCalculationService): boolean {
    switch (this.operator) {
      case LogicalOperator.AND:
        for (const condition of this.conditions) {
          if (!condition.evaluate(stock, calcService)) {
            return false;
          }
        }

        for (const subGroup of this.subGroups) {
          if (!subGroup.match(stock, calcService)) {
            return false;
          }
        }

        return true;

      case LogicalOperator.OR:
        for (const condition of this.conditions) {
          if (condition.evaluate(stock, calcService)) {
            return true;
          }
        }

        for (const subGroup of this.subGroups) {
          if (subGroup.match(stock, calcService)) {
            return true;
          }
        }

        return false;

      case LogicalOperator.NOT:
        if (this.conditions.length === 1) {
          const condition = this.conditions[0];
          return condition ? !condition.evaluate(stock, calcService) : false;
        }

        if (this.subGroups.length === 1) {
          const subGroup = this.subGroups[0];
          return subGroup ? !subGroup.match(stock, calcService) : false;
        }

        return false;

      default:
        return false;
    }
  }

  /**
   * 异步递归匹配股票是否满足此条件组
   *
   * 用于支持异步指标计算（如历史指标）。
   */
  async matchAsync(
    stock: Stock,
    calcService: IIndicatorCalculationService,
  ): Promise<boolean> {
    switch (this.operator) {
      case LogicalOperator.AND:
        for (const condition of this.conditions) {
          if (!(await condition.evaluateAsync(stock, calcService))) {
            return false;
          }
        }

        for (const subGroup of this.subGroups) {
          if (!(await subGroup.matchAsync(stock, calcService))) {
            return false;
          }
        }

        return true;

      case LogicalOperator.OR:
        for (const condition of this.conditions) {
          if (await condition.evaluateAsync(stock, calcService)) {
            return true;
          }
        }

        for (const subGroup of this.subGroups) {
          if (await subGroup.matchAsync(stock, calcService)) {
            return true;
          }
        }

        return false;

      case LogicalOperator.NOT:
        if (this.conditions.length === 1) {
          const condition = this.conditions[0];
          return condition
            ? !(await condition.evaluateAsync(stock, calcService))
            : false;
        }

        if (this.subGroups.length === 1) {
          const subGroup = this.subGroups[0];
          return subGroup
            ? !(await subGroup.matchAsync(stock, calcService))
            : false;
        }

        return false;

      default:
        return false;
    }
  }

  /**
   * 递归检查是否包含任何有效条件
   *
   * @returns 是否包含至少一个条件
   *
   * Requirements: 1.6
   */
  hasAnyCondition(): boolean {
    // 检查直接条件
    if (this.conditions.length > 0) {
      return true;
    }

    // 递归检查子组
    return this.subGroups.some((subGroup) => subGroup.hasAnyCondition());
  }

  /**
   * 递归计数所有条件总数
   *
   * @returns 条件总数（包括所有嵌套层级）
   */
  countTotalConditions(): number {
    // 直接条件数量
    const directCount = this.conditions.length;

    // 递归计数子组中的条件
    const subGroupCount = this.subGroups.reduce(
      (sum, subGroup) => sum + subGroup.countTotalConditions(),
      0,
    );

    return directCount + subGroupCount;
  }

  /**
   * 序列化为普通对象（递归）
   *
   * @returns 序列化后的对象
   *
   * Requirements: 2.5
   */
  toDict(): Record<string, unknown> {
    return {
      groupId: this.groupId,
      operator: this.operator,
      conditions: this.conditions.map((c) => c.toDict()),
      subGroups: this.subGroups.map((g) => g.toDict()),
    };
  }

  /**
   * 从普通对象反序列化（递归）
   *
   * @param data 序列化的对象
   * @returns FilterGroup 实例
   *
   * Requirements: 2.5
   */
  static fromDict(data: Record<string, unknown>): FilterGroup {
    const groupId = data.groupId as string;
    const operator = data.operator as LogicalOperator;

    // 反序列化条件
    const conditionsData = (data.conditions as Record<string, unknown>[]) ?? [];
    const conditions = conditionsData.map((c) => FilterCondition.fromDict(c));

    // 递归反序列化子组
    const subGroupsData = (data.subGroups as Record<string, unknown>[]) ?? [];
    const subGroups = subGroupsData.map((g) => FilterGroup.fromDict(g));

    return FilterGroup.create(operator, conditions, subGroups, groupId);
  }

  /**
   * 判断两个 FilterGroup 是否相等（基于 groupId）
   */
  equals(other: FilterGroup | null | undefined): boolean {
    if (other === null || other === undefined) {
      return false;
    }
    return this.groupId === other.groupId;
  }

  /**
   * 转换为字符串表示（递归）
   */
  toString(): string {
    const conditionStrs = this.conditions.map((c) => c.toString());
    const subGroupStrs = this.subGroups.map((g) => `(${g.toString()})`);
    const allStrs = [...conditionStrs, ...subGroupStrs];

    if (allStrs.length === 0) {
      return `${this.operator} []`;
    }

    const separator =
      this.operator === LogicalOperator.NOT ? " " : ` ${this.operator} `;
    return allStrs.join(separator);
  }
}

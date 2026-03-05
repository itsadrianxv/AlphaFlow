/**
 * 逻辑运算符枚举
 * 定义 FilterGroup 中条件组合的逻辑关系
 */
export enum LogicalOperator {
  /** 与：所有子条件和子组都匹配时返回 true */
  AND = "AND",
  /** 或：至少一个子条件或子组匹配时返回 true */
  OR = "OR",
  /** 非：对唯一子元素的匹配结果取反（仅允许一个子元素） */
  NOT = "NOT",
}

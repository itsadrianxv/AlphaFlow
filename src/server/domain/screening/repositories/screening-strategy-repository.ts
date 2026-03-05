/**
 * IScreeningStrategyRepository 接口
 *
 * 定义筛选策略聚合根的持久化操作接口。
 * 遵循依赖倒置原则：领域层定义接口，基础设施层提供实现。
 *
 * Requirements: 1.1, 1.7
 */

import type { ScreeningStrategy } from "../aggregates/screening-strategy";

/**
 * 筛选策略仓储接口
 */
export interface IScreeningStrategyRepository {
  /**
   * 保存策略（创建或更新）
   * @param strategy 筛选策略
   */
  save(strategy: ScreeningStrategy): Promise<void>;

  /**
   * 根据 ID 查找策略
   * @param id 策略 ID
   * @returns 策略实例或 null
   */
  findById(id: string): Promise<ScreeningStrategy | null>;

  /**
   * 删除策略
   * @param id 策略 ID
   */
  delete(id: string): Promise<void>;

  /**
   * 查找所有策略（支持分页）
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 策略列表
   */
  findAll(limit?: number, offset?: number): Promise<ScreeningStrategy[]>;

  /**
   * 查找所有模板策略
   * @returns 模板策略列表
   */
  findTemplates(): Promise<ScreeningStrategy[]>;

  /**
   * 根据名称查找策略
   * @param name 策略名称
   * @returns 策略实例或 null
   */
  findByName(name: string): Promise<ScreeningStrategy | null>;
}

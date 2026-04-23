/**
 * IScreeningSessionRepository 接口
 *
 * 定义筛选会话聚合根的持久化操作接口。
 * 遵循依赖倒置原则：领域层定义接口，基础设施层提供实现。
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import type { ScreeningSession } from "../aggregates/screening-session";

/**
 * 筛选会话仓储接口
 */
export interface IScreeningSessionRepository {
  /**
   * 保存会话
   * @param session 筛选会话
   */
  save(session: ScreeningSession): Promise<void>;

  /**
   * 根据 ID 查找会话
   * @param id 会话 ID
   * @returns 会话实例或 null
   */
  findById(id: string): Promise<ScreeningSession | null>;

  /**
   * 删除会话
   * @param id 会话 ID
   */
  delete(id: string): Promise<void>;

  /**
   * 根据策略 ID 查找会话列表
   * @param strategyId 策略 ID
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 会话列表
   */
  findByStrategy(
    strategyId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]>;

  /**
   * 根据策略 ID 和用户 ID 查找会话列表
   * @param strategyId 策略 ID
   * @param userId 用户 ID
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 会话列表
   */
  findByStrategyForUser(
    strategyId: string,
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]>;

  /**
   * 查找最近的会话列表（按执行时间降序）
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 会话列表
   */
  findRecentSessions(
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]>;

  /**
   * 查找指定用户最近会话（按执行时间降序）
   * @param userId 用户 ID
   * @param limit 限制数量（可选）
   * @param offset 偏移量（可选）
   * @returns 会话列表
   */
  findRecentSessionsByUser(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]>;

  /**
   * 领取下一个待执行会话
   */
  claimNextPendingSession(): Promise<ScreeningSession | null>;

  /**
   * 获取运行中的会话，用于故障恢复
   */
  findRunningSessions(limit?: number): Promise<ScreeningSession[]>;
}

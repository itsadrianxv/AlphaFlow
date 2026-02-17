/**
 * IWatchListRepository 接口
 *
 * 定义自选股列表聚合根的持久化操作接口。
 * 遵循依赖倒置原则：领域层定义接口，基础设施层提供实现。
 *
 * Requirements: 5.1
 */

import type { WatchList } from "../aggregates/watch-list";

/**
 * 自选股列表仓储接口
 */
export interface IWatchListRepository {
  /**
   * 保存自选股列表（创建或更新）
   * @param watchList 自选股列表
   */
  save(watchList: WatchList): Promise<void>;

  /**
   * 根据 ID 查找自选股列表
   * @param id 列表 ID
   * @returns 列表实例或 null
   */
  findById(id: string): Promise<WatchList | null>;

  /**
   * 删除自选股列表
   * @param id 列表 ID
   */
  delete(id: string): Promise<void>;

  /**
   * 查找所有自选股列表
   * @returns 列表数组
   */
  findAll(): Promise<WatchList[]>;

  /**
   * 根据名称查找自选股列表
   * @param name 列表名称
   * @returns 列表实例或 null
   */
  findByName(name: string): Promise<WatchList | null>;
}

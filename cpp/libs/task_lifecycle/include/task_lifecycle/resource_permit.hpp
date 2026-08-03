#pragma once

#include <stop_token>
#include <optional>
#include <compare>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "task_lifecycle/types.hpp"

namespace task_lifecycle {

struct ResourcePermitLease {
  std::string task_id;
  std::string resource_pool_key;
  std::string permit_key;
  std::string holder_id;
  std::int64_t fencing_token{};

  auto operator<=>(const ResourcePermitLease&) const = default;
};

/**
 * 短期全局资源许可接口。实现负责将租约持久化到权威存储，Worker
 * 只协调获取、续租和释放。
 */
class ResourcePermitProvider {
 public:
  virtual ~ResourcePermitProvider() = default;
  virtual std::optional<ResourcePermitLease> acquire(const Lease& task,
                                                     std::stop_token stop_token) = 0;
  virtual std::vector<ResourcePermitLease> renew(
      const std::vector<ResourcePermitLease>& permits) = 0;
  virtual void release(const ResourcePermitLease& permit, std::string_view reason) = 0;
};

}  // 命名空间 task_lifecycle

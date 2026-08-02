#pragma once

#include <vector>

#include "config.hpp"
#include "types.hpp"

class LlmTaskRepository {
 public:
  explicit LlmTaskRepository(const Config& config) : config_(config) {}

  LlmTaskClaimResult claim(const task_lifecycle::StreamMessage& message) const;
  std::vector<task_lifecycle::Lease> renew(const std::vector<task_lifecycle::Lease>& leases) const;
  void settle(const LlmTask& task, LlmTaskSettlement settlement) const;
  bool ping() const;

 private:
  const Config& config_;
};

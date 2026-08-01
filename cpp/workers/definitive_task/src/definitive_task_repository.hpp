#pragma once

#include <chrono>
#include <string>
#include <utility>
#include <vector>

#include "config.hpp"
#include "types.hpp"

class DefinitiveTaskRepository {
 public:
  explicit DefinitiveTaskRepository(const Config& config) : config_(config) {}

  DefinitiveTaskClaimResult claim(const task_lifecycle::StreamMessage& message) const;
  std::vector<task_lifecycle::Lease> renew(const std::vector<task_lifecycle::Lease>& leases) const;
  void settle(const DefinitiveTask& task, DefinitiveTaskSettlement settlement) const;
  bool ping() const;

 private:
  const Config& config_;
};


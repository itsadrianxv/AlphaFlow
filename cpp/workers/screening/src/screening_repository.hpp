#pragma once

#include <string>
#include <utility>
#include <vector>

#include "config.hpp"
#include "types.hpp"

class ScreeningRepository {
 public:
  explicit ScreeningRepository(const Config& config) : config_(config) {}

  ScreeningClaimResult claim(const task_lifecycle::StreamMessage& message) const;
  std::vector<task_lifecycle::Lease> renew(
      const std::vector<task_lifecycle::Lease>& leases) const;
  void settle(const ScreeningTask& task, ScreeningSettlement settlement) const;
  bool ping() const;

 private:
  const Config& config_;
};

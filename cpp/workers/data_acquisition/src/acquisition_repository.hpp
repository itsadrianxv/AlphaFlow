#pragma once

#include <vector>

#include "config.hpp"
#include "types.hpp"

class AcquisitionRepository {
 public:
  explicit AcquisitionRepository(Config config) : config_(std::move(config)) {}

  AcquisitionClaimResult claim(const task_lifecycle::StreamMessage& message) const;
  std::vector<task_lifecycle::Lease> renew(const std::vector<task_lifecycle::Lease>& leases) const;
  void settle(const AcquisitionTask& task, AcquisitionSettlement settlement) const;
  bool ping() const;

 private:
  Config config_;
};

#pragma once

#include <chrono>
#include <string>
#include <utility>
#include <vector>

#include "config.hpp"
#include "types.hpp"

class ScreeningRepository {
 public:
  explicit ScreeningRepository(const Config& config) : config_(config) {}

  ClaimResult claim(const StreamMessage& message) const;
  std::vector<std::pair<std::string, std::int64_t>> heartbeat(
      const std::vector<std::pair<std::string, std::int64_t>>& leases) const;
  bool schedule_retry(const RunTask& task, const WorkerError& error, int delay_seconds) const;
  bool mark_failed(const RunTask& task, const WorkerError& error) const;
  void commit_result(const RunTask& task, const ScreeningExecutionResult& result) const;
  bool ping() const;

 private:
  const Config& config_;
};

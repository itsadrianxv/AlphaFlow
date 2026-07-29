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

  ClaimResult claim(const StreamMessage& message) const;
  std::vector<std::pair<std::string, std::int64_t>> heartbeat(
      const std::vector<std::pair<std::string, std::int64_t>>& leases) const;
  bool schedule_retry(const RunTask& task, const WorkerError& error, int delay_seconds) const;
  bool mark_submitted(const std::string& execution_id) const;
  bool mark_failed(const RunTask& task, const WorkerError& error) const;
  void commit_result(const RunTask& task, const DefinitiveTaskExecutionResult& result) const;
  bool ping() const;

 private:
  const Config& config_;
};


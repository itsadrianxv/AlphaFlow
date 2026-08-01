#pragma once

#include <atomic>
#include <string>

#include "config.hpp"
#include "types.hpp"

class PythonClient {
 public:
  PythonClient(const Config& config, const std::atomic<bool>& stopping)
      : config_(config), stopping_(stopping) {}

  ScreeningExecutionResult execute(const RunTask& task) const;
  bool health() const;

  static ScreeningExecutionResult parse_response(const std::string& body, const std::string& expected_run_id);
  static bool retryable_http_status(long status);

 private:
  const Config& config_;
  const std::atomic<bool>& stopping_;
};

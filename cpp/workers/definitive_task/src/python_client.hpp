#pragma once

#include <stop_token>
#include <string>

#include "config.hpp"
#include "types.hpp"

class PythonClient {
 public:
  explicit PythonClient(const Config& config) : config_(config) {}

  task_lifecycle::ExecutionResult<DefinitiveTaskExecutionResult> execute(
      const DefinitiveTask& task, std::stop_token stop_token) const;
  bool health() const;

  static DefinitiveTaskExecutionResult parse_response(const std::string& body, const std::string& expected_run_id);
  static bool retryable_http_status(long status);

 private:
  const Config& config_;
};


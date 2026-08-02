#pragma once

#include <stop_token>
#include <string>
#include <string_view>

#include "config.hpp"
#include "types.hpp"

class InternalClient {
 public:
  explicit InternalClient(const Config& config) : config_(config) {}

  task_lifecycle::ExecutionResult<LlmExecutionResult> execute(const LlmTask& task,
                                                               std::stop_token stop_token) const;
  bool health() const;

  static LlmExecutionResult parse_response(const std::string& body, const LlmTask& task);
  static task_lifecycle::ExecutionResult<LlmExecutionResult> classify_http_failure(
      long status, std::string_view body);
  static bool retryable_http_status(long status);
  static nlohmann::json request_payload(const LlmTask& task);

 private:
  const Config& config_;
};

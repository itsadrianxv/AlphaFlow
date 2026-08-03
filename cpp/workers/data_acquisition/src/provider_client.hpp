#pragma once

#include <stop_token>
#include <string>
#include <string_view>

#include "config.hpp"
#include "types.hpp"

class ProviderClient {
 public:
  explicit ProviderClient(Config config) : config_(std::move(config)) {}

  task_lifecycle::ExecutionResult<ProviderFetchResult> execute(
      const AcquisitionTask& task, std::stop_token stop_token) const;
  bool health() const;

  static nlohmann::json request_payload(const AcquisitionTask& task);
  static ProviderFetchResult parse_response(const std::string& body);
  static bool retryable_http_status(long status);
  static task_lifecycle::ExecutionResult<ProviderFetchResult> classify_http_failure(
      long status, std::string_view body);

 private:
  Config config_;
};

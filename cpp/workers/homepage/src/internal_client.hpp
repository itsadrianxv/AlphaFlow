#pragma once
#include <stop_token>
#include "config.hpp"
#include "types.hpp"
class InternalClient {
 public:
  explicit InternalClient(const Config& config):config_(config){}
  task_lifecycle::ExecutionResult<HomePageGenerationResult> execute(const HomePageTask&,std::stop_token) const;
  bool health() const;
  static HomePageGenerationResult parse_response(const std::string& body);
  static bool retryable_http_status(long status);
 private: const Config& config_;
};

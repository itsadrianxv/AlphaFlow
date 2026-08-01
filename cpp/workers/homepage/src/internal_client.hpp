#pragma once
#include <atomic>
#include "config.hpp"
#include "types.hpp"
class InternalClient {
 public:
  InternalClient(const Config& config,const std::atomic<bool>& stopping):config_(config),stopping_(stopping){}
  HomePageGenerationResult execute(const RunTask& task) const;
  bool health() const;
  static HomePageGenerationResult parse_response(const std::string& body);
  static bool retryable_http_status(long status);
 private: const Config& config_; const std::atomic<bool>& stopping_;
};

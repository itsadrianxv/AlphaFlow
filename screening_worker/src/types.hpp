#pragma once

#include <chrono>
#include <cstdint>
#include <string>
#include <stdexcept>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

struct StreamMessage {
  std::string message_id;
  std::string event_id;
  std::string run_id;
  std::string created_at;
  std::string schema_version{"1"};
};

struct RunTask {
  StreamMessage message;
  std::int64_t fencing_token{};
  int attempt{};
  nlohmann::json config;
};

struct ScreeningResultRow {
  std::string stock_code;
  int rank{};
};

struct ScreeningExecutionResult {
  std::string run_id;
  std::string status;
  int universe_count{};
  int total_count{};
  std::vector<ScreeningResultRow> results;
  nlohmann::json warnings = nlohmann::json::array();
  nlohmann::json diagnostics = nlohmann::json::object();
};

enum class ClaimStatus { claimed, busy, terminal, missing };

struct RetryTask {
  StreamMessage message;
  std::chrono::steady_clock::time_point due_at;
};

struct ClaimResult {
  ClaimStatus status{ClaimStatus::missing};
  RunTask task;
};

class WorkerError : public std::runtime_error {
 public:
  WorkerError(std::string code, std::string message, bool retryable)
      : std::runtime_error(std::move(message)), code_(std::move(code)), retryable_(retryable) {}
  const std::string& code() const { return code_; }
  bool retryable() const { return retryable_; }

 private:
  std::string code_;
  bool retryable_;
};

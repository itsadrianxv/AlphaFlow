#pragma once

#include <cstdint>
#include <cstddef>
#include <any>
#include <functional>
#include <stdexcept>
#include <string>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace task_runtime {

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

enum class ClaimStatus { claimed, busy, terminal, missing };
struct ClaimResult { ClaimStatus status{ClaimStatus::missing}; RunTask task; };

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

using ExecutionOutcome = std::any;

struct WorkerDefinition {
  std::function<ClaimResult(const StreamMessage&)> claim;
  std::function<ExecutionOutcome(const RunTask&)> execute;
  std::function<void(const RunTask&, const ExecutionOutcome&)> commit;
  std::function<void(const RunTask&, const WorkerError&, int)> schedule_retry;
  std::function<void(const RunTask&)> republish;
  std::function<void(const RunTask&, const WorkerError&)> mark_failed;
  std::function<std::vector<std::pair<std::string, std::int64_t>>()> lease_snapshot;
  std::function<std::vector<std::pair<std::string, std::int64_t>>(const std::vector<std::pair<std::string, std::int64_t>>&)> heartbeat;
  std::function<bool()> ping;
};

struct RuntimeConfig {
  std::size_t worker_threads{1};
  std::size_t queue_capacity{1};
  int heartbeat_seconds{30};
  int recovery_interval_ms{1000};
  int probe_interval_ms{5000};
  int max_attempts{3};
};

}  // namespace task_runtime

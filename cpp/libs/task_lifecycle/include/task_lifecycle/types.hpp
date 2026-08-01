#pragma once

#include <chrono>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <stop_token>
#include <string>
#include <variant>
#include <vector>

#include "messaging/stream_transport.hpp"

namespace task_lifecycle {

using StreamMessage = messaging::StreamMessage;

class ExecutionError : public std::runtime_error {
 public:
  ExecutionError(std::string code, std::string message, bool retryable)
      : std::runtime_error(std::move(message)), code_(std::move(code)), retryable_(retryable) {}
  const std::string& code() const { return code_; }
  bool retryable() const { return retryable_; }

 private:
  std::string code_;
  bool retryable_;
};

struct Failure {
  std::string code;
  std::string message;
};

template <typename Result>
struct Completed {
  Result result;
};

struct RetryableFailure {
  Failure failure;
};

struct TerminalFailure {
  Failure failure;
};

struct Obsolete {};

template <typename Result>
using ExecutionResult = std::variant<Completed<Result>, RetryableFailure, TerminalFailure, Obsolete>;

template <typename Input>
struct Task {
  StreamMessage message;
  std::int64_t fencing_token{};
  int attempt{};
  Input input;
};

struct Lease {
  std::string task_id;
  std::int64_t fencing_token{};
  auto operator<=>(const Lease&) const = default;
};

enum class ClaimDisposition { claimed, defer, discard };

template <typename Input>
struct ClaimResult {
  ClaimDisposition disposition{ClaimDisposition::discard};
  std::optional<Task<Input>> task;

  static ClaimResult claimed(Task<Input> value) {
    return {ClaimDisposition::claimed, std::move(value)};
  }
  static ClaimResult defer() { return {ClaimDisposition::defer, std::nullopt}; }
  static ClaimResult discard() { return {ClaimDisposition::discard, std::nullopt}; }
};

enum class SettlementDisposition { completed, retry, terminal_failure, obsolete };

template <typename Result>
struct Settlement {
  SettlementDisposition disposition;
  std::optional<Result> result;
  std::optional<Failure> failure;
  std::chrono::seconds retry_delay{};

  static Settlement completed(Result value) {
    return {SettlementDisposition::completed, std::move(value), std::nullopt, {}};
  }
  static Settlement retry(Failure value, std::chrono::seconds delay) {
    return {SettlementDisposition::retry, std::nullopt, std::move(value), delay};
  }
  static Settlement terminal(Failure value) {
    return {SettlementDisposition::terminal_failure, std::nullopt, std::move(value), {}};
  }
  static Settlement obsolete() {
    return {SettlementDisposition::obsolete, std::nullopt, std::nullopt, {}};
  }
};

class LeaseLost : public std::runtime_error {
 public:
  explicit LeaseLost(const std::string& message) : std::runtime_error(message) {}
};

}  // namespace task_lifecycle

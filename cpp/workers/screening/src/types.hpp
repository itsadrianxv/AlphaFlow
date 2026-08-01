#pragma once

#include <chrono>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "task_runtime/types.hpp"

using StreamMessage = task_runtime::StreamMessage;
using RunTask = task_runtime::RunTask;
using ClaimStatus = task_runtime::ClaimStatus;
using ClaimResult = task_runtime::ClaimResult;
using WorkerError = task_runtime::WorkerError;

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

struct RetryTask {
  StreamMessage message;
  std::chrono::steady_clock::time_point due_at;
};

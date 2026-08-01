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

struct DefinitiveTaskResultRow {
  std::string stock_code;
  std::string stock_name;
  int rank{};
  bool selected{};
  std::string evaluation_status;
  double score{};
  double max_score{};
  nlohmann::json rule_results = nlohmann::json::object();
};

struct DefinitiveTaskExecutionResult {
  std::string run_id;
  std::string status;
  std::string as_of_date;
  int universe_count{};
  int evaluated_count{};
  int selected_count{};
  std::vector<DefinitiveTaskResultRow> results;
  nlohmann::json rules = nlohmann::json::array();
  nlohmann::json warnings = nlohmann::json::array();
  nlohmann::json diagnostics = nlohmann::json::object();
};

struct RetryTask {
  StreamMessage message;
  std::chrono::steady_clock::time_point due_at;
};

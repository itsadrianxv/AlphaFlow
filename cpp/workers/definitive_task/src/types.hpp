#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "task_lifecycle/types.hpp"

using DefinitiveTaskInput = nlohmann::json;
using DefinitiveTask = task_lifecycle::Task<DefinitiveTaskInput>;
using DefinitiveTaskClaimResult = task_lifecycle::ClaimResult<DefinitiveTaskInput>;
using WorkerError = task_lifecycle::ExecutionError;

struct DefinitiveTaskResultRow {
  std::string stock_code;
  std::string stock_name;
  int rank{};
  bool selected{};
  std::string evaluation_status;
  double score{};
  double minimum_possible_score{};
  double maximum_possible_score{};
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

using DefinitiveTaskSettlement = task_lifecycle::Settlement<DefinitiveTaskExecutionResult>;

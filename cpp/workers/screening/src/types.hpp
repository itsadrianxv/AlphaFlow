#pragma once

#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "task_lifecycle/types.hpp"

using ScreeningInput = nlohmann::json;
using ScreeningTask = task_lifecycle::Task<ScreeningInput>;
using ScreeningClaimResult = task_lifecycle::ClaimResult<ScreeningInput>;

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

using ScreeningSettlement = task_lifecycle::Settlement<ScreeningExecutionResult>;

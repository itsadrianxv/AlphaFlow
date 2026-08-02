#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "task_lifecycle/types.hpp"

struct LlmTaskInput {
  std::string task_type;
  std::string idempotency_key;
  std::string input_hash;
  nlohmann::json payload = nlohmann::json::object();
};

using LlmTask = task_lifecycle::Task<LlmTaskInput>;
using LlmTaskClaimResult = task_lifecycle::ClaimResult<LlmTaskInput>;
using WorkerError = task_lifecycle::ExecutionError;

struct LlmExecutionResult {
  std::string task_id;
  std::string task_type;
  std::string idempotency_key;
  std::string input_hash;
  nlohmann::json result = nlohmann::json::object();
  nlohmann::json metadata = nlohmann::json::object();
};

using LlmTaskSettlement = task_lifecycle::Settlement<LlmExecutionResult>;

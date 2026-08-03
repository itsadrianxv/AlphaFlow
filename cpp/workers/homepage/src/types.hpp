#pragma once
#include <cstdint>
#include <nlohmann/json.hpp>
#include "task_lifecycle/types.hpp"
using HomePageInput=nlohmann::json;
using HomePageTask=task_lifecycle::Task<HomePageInput>;
using HomePageClaimResult=task_lifecycle::ClaimResult<HomePageInput>;
using WorkerError=task_lifecycle::ExecutionError;
struct HomePageGenerationResult {
  std::string task_id;
  std::string manifest_id;
  std::int64_t activation_sequence{};
  std::string promotion_mode;
  std::string generation_input_contract_version;
  std::string generator_definition_version;
  std::string payload_schema_version;
  std::string input_hash;
  std::string payload_hash;
  nlohmann::json payload;
  nlohmann::json data_coverage;
};
using HomePageSettlement=task_lifecycle::Settlement<HomePageGenerationResult>;

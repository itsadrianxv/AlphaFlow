#pragma once

#include <nlohmann/json.hpp>
#include <string>

#include "task_lifecycle/types.hpp"

struct AcquisitionAttemptInput {
  std::string attempt_id;
  std::string manifest_item_id;
  std::string dataset_key;
  std::string provider_key;
  std::string provider_contract_version;
  std::string normalization_rules_version;
  std::string idempotency_key;
  std::string request_fingerprint;
  std::string target_data_cutoff_key;
  nlohmann::json fact_scope_json = nlohmann::json::object();
  nlohmann::json target_data_cutoff_json = nlohmann::json::object();
};

struct ProviderFetchResult {
  nlohmann::json envelope;
  std::string result_status;
  std::string result_hash;
};

using AcquisitionTask = task_lifecycle::Task<AcquisitionAttemptInput>;
using AcquisitionClaimResult = task_lifecycle::ClaimResult<AcquisitionAttemptInput>;
using AcquisitionSettlement = task_lifecycle::Settlement<ProviderFetchResult>;
using WorkerError = task_lifecycle::ExecutionError;

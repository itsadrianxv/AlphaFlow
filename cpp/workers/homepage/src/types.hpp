#pragma once
#include <nlohmann/json.hpp>
#include "task_lifecycle/types.hpp"
using HomePageInput=nlohmann::json;
using HomePageTask=task_lifecycle::Task<HomePageInput>;
using HomePageClaimResult=task_lifecycle::ClaimResult<HomePageInput>;
using WorkerError=task_lifecycle::ExecutionError;
struct HomePageGenerationResult { nlohmann::json payload; std::string data_as_of; };
using HomePageSettlement=task_lifecycle::Settlement<HomePageGenerationResult>;

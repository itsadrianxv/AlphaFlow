#pragma once
#include <nlohmann/json.hpp>
#include "task_runtime/types.hpp"
using StreamMessage=task_runtime::StreamMessage; using RunTask=task_runtime::RunTask; using ClaimStatus=task_runtime::ClaimStatus; using ClaimResult=task_runtime::ClaimResult; using WorkerError=task_runtime::WorkerError;
struct HomePageGenerationResult { nlohmann::json payload; std::string data_as_of; };

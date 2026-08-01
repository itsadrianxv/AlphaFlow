#include "python_client.hpp"

#include <curl/curl.h>
#include <nlohmann/json.hpp>

#include <regex>
#include <set>
#include <stdexcept>

namespace {
size_t append_body(char* data, size_t size, size_t count, void* output) {
  static_cast<std::string*>(output)->append(data, size * count);
  return size * count;
}

size_t discard_body(char*, size_t size, size_t count, void*) { return size * count; }

int progress_callback(void* state, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
  return static_cast<const std::stop_token*>(state)->stop_requested() ? 1 : 0;
}

struct CurlHandle {
  CURL* value{curl_easy_init()};
  ~CurlHandle() { if (value) curl_easy_cleanup(value); }
};
}  // namespace

bool PythonClient::retryable_http_status(long status) {
  return status == 408 || status == 429 || status >= 500;
}

ScreeningExecutionResult PythonClient::parse_response(const std::string& body, const std::string& expected_run_id) {
  nlohmann::json payload;
  try {
    payload = nlohmann::json::parse(body);
  } catch (const std::exception& error) {
    throw task_lifecycle::ExecutionError("INVALID_PYTHON_JSON", error.what(), false);
  }
  try {
    ScreeningExecutionResult result;
    result.run_id = payload.at("runId").get<std::string>();
    result.status = payload.at("status").get<std::string>();
    result.universe_count = payload.at("universeCount").get<int>();
    result.total_count = payload.at("totalCount").get<int>();
    result.warnings = payload.at("warnings");
    result.diagnostics = payload.at("diagnostics");
    if (result.run_id != expected_run_id) throw std::runtime_error("runId 不一致");
    if (result.status != "SUCCEEDED" && result.status != "PARTIAL") throw std::runtime_error("status 不合法");
    if (result.universe_count < 0 || result.total_count < 0 || !result.warnings.is_array() || !result.diagnostics.is_object()) {
      throw std::runtime_error("计数或诊断字段不合法");
    }
    const auto& rows = payload.at("results");
    if (!rows.is_array() || static_cast<int>(rows.size()) != result.total_count) throw std::runtime_error("totalCount 与结果数不一致");
    std::set<std::string> stocks;
    std::set<int> ranks;
    static const std::regex stock_pattern(R"(^[0-9]{6}$)");
    for (const auto& row : rows) {
      ScreeningResultRow value{row.at("stockCode").get<std::string>(), row.at("rank").get<int>()};
      if (!std::regex_match(value.stock_code, stock_pattern)) throw std::runtime_error("股票代码不合法");
      if (!stocks.insert(value.stock_code).second || !ranks.insert(value.rank).second) throw std::runtime_error("股票代码或 rank 重复");
      result.results.push_back(std::move(value));
    }
    for (int rank = 1; rank <= result.total_count; ++rank) {
      if (!ranks.contains(rank)) throw std::runtime_error("rank 必须从 1 连续递增");
    }
    return result;
  } catch (const task_lifecycle::ExecutionError&) {
    throw;
  } catch (const std::exception& error) {
    throw task_lifecycle::ExecutionError("INVALID_PYTHON_RESPONSE", error.what(), false);
  }
}

task_lifecycle::ExecutionResult<ScreeningExecutionResult> PythonClient::execute(
    const ScreeningTask& task, std::stop_token stop_token) const {
  CurlHandle curl;
  if (!curl.value) return task_lifecycle::RetryableFailure{{"PYTHON_CONNECTION_ERROR", "无法初始化 libcurl"}};
  const std::string request = nlohmann::json{{"runId", task.message.run_id}, {"config", task.input}}.dump();
  std::string response;
  const std::string url = config_.python_service_url + "/api/v1/screening/execute-run";
  curl_slist* headers = curl_slist_append(nullptr, "Content-Type: application/json");
  curl_easy_setopt(curl.value, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl.value, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl.value, CURLOPT_POSTFIELDS, request.c_str());
  curl_easy_setopt(curl.value, CURLOPT_POSTFIELDSIZE, static_cast<long>(request.size()));
  curl_easy_setopt(curl.value, CURLOPT_WRITEFUNCTION, append_body);
  curl_easy_setopt(curl.value, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(curl.value, CURLOPT_TIMEOUT_MS, static_cast<long>(config_.python_timeout_ms));
  curl_easy_setopt(curl.value, CURLOPT_CONNECTTIMEOUT_MS, 10000L);
  curl_easy_setopt(curl.value, CURLOPT_XFERINFOFUNCTION, progress_callback);
  curl_easy_setopt(curl.value, CURLOPT_XFERINFODATA, &stop_token);
  curl_easy_setopt(curl.value, CURLOPT_NOPROGRESS, 0L);
  const CURLcode code = curl_easy_perform(curl.value);
  long status = 0;
  curl_easy_getinfo(curl.value, CURLINFO_RESPONSE_CODE, &status);
  curl_slist_free_all(headers);
  if (code != CURLE_OK) {
    if (code == CURLE_ABORTED_BY_CALLBACK && stop_token.stop_requested()) {
      return task_lifecycle::Obsolete{};
    }
    return task_lifecycle::RetryableFailure{{
        code == CURLE_OPERATION_TIMEDOUT ? "PYTHON_TIMEOUT" : "PYTHON_CONNECTION_ERROR",
        curl_easy_strerror(code)}};
  }
  if (status < 200 || status >= 300) {
    task_lifecycle::Failure failure{"PYTHON_HTTP_" + std::to_string(status), response};
    if (retryable_http_status(status)) return task_lifecycle::RetryableFailure{std::move(failure)};
    return task_lifecycle::TerminalFailure{std::move(failure)};
  }
  try {
    return task_lifecycle::Completed{parse_response(response, task.message.run_id)};
  } catch (const task_lifecycle::ExecutionError& error) {
    task_lifecycle::Failure failure{error.code(), error.what()};
    if (error.retryable()) return task_lifecycle::RetryableFailure{std::move(failure)};
    return task_lifecycle::TerminalFailure{std::move(failure)};
  }
}

bool PythonClient::health() const {
  CurlHandle curl;
  if (!curl.value) return false;
  const std::string url = config_.python_service_url + "/health";
  curl_easy_setopt(curl.value, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl.value, CURLOPT_WRITEFUNCTION, discard_body);
  curl_easy_setopt(curl.value, CURLOPT_TIMEOUT_MS, 3000L);
  const CURLcode code = curl_easy_perform(curl.value);
  long status = 0;
  curl_easy_getinfo(curl.value, CURLINFO_RESPONSE_CODE, &status);
  return code == CURLE_OK && status >= 200 && status < 300;
}

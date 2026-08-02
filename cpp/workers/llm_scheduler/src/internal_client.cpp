#include "internal_client.hpp"

#include <curl/curl.h>

#include <utility>

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
  ~CurlHandle() {
    if (value) curl_easy_cleanup(value);
  }
};

std::string response_text(std::string_view body) {
  return body.empty() ? "内部接口未返回错误详情" : std::string(body);
}

}  // namespace

bool InternalClient::retryable_http_status(long status) {
  return status == 408 || status == 429 || status >= 500;
}

nlohmann::json InternalClient::request_payload(const LlmTask& task) {
  return nlohmann::json{{"schemaVersion", 1},
                        {"taskId", task.message.run_id},
                        {"taskType", task.input.task_type},
                        {"idempotencyKey", task.input.idempotency_key},
                        {"inputHash", task.input.input_hash},
                        {"attempt", task.attempt}};
}

LlmExecutionResult InternalClient::parse_response(const std::string& body, const LlmTask& task) {
  nlohmann::json payload;
  try {
    payload = nlohmann::json::parse(body);
  } catch (const std::exception& error) {
    throw WorkerError("INVALID_LLM_RESPONSE_JSON", error.what(), false);
  }

  try {
    if (!payload.is_object()) throw std::runtime_error("响应必须是 JSON 对象");
    if (payload.value("status", "") != "COMPLETED") throw std::runtime_error("status 必须为 COMPLETED");

    LlmExecutionResult result;
    result.task_id = payload.at("taskId").get<std::string>();
    result.task_type = payload.at("taskType").get<std::string>();
    result.idempotency_key = payload.at("idempotencyKey").get<std::string>();
    result.input_hash = payload.at("inputHash").get<std::string>();
    result.result = payload.at("result");
    result.metadata = payload.value("metadata", nlohmann::json::object());

    if (result.task_id != task.message.run_id) throw std::runtime_error("taskId 不一致");
    if (result.task_type != task.input.task_type) throw std::runtime_error("taskType 不一致");
    if (result.idempotency_key != task.input.idempotency_key) throw std::runtime_error("idempotencyKey 不一致");
    if (result.input_hash != task.input.input_hash) throw std::runtime_error("inputHash 不一致");
    if (!result.result.is_object() || !result.metadata.is_object()) {
      throw std::runtime_error("result 和 metadata 必须是 JSON 对象");
    }
    return result;
  } catch (const WorkerError&) {
    throw;
  } catch (const std::exception& error) {
    throw WorkerError("INVALID_LLM_RESPONSE", error.what(), false);
  }
}

task_lifecycle::ExecutionResult<LlmExecutionResult> InternalClient::classify_http_failure(
    long status, std::string_view body) {
  const std::string default_code = "LLM_HTTP_" + std::to_string(status);
  std::string code = default_code;
  std::string message = response_text(body);
  bool retryable = retryable_http_status(status);
  bool obsolete = false;
  try {
    const auto payload = nlohmann::json::parse(body);
    if (payload.is_object()) {
      code = payload.value("code", code);
      message = payload.value("message", message);
      retryable = payload.value("retryable", retryable);
      obsolete = payload.value("obsolete", false) || code == "TASK_OBSOLETE";
    }
  } catch (...) {
    // 非 JSON 错误体仍按 HTTP 状态分类。
  }
  if (obsolete) return task_lifecycle::Obsolete{};
  task_lifecycle::Failure failure{std::move(code), std::move(message)};
  if (retryable) return task_lifecycle::RetryableFailure{std::move(failure)};
  return task_lifecycle::TerminalFailure{std::move(failure)};
}

task_lifecycle::ExecutionResult<LlmExecutionResult> InternalClient::execute(
    const LlmTask& task, std::stop_token stop_token) const {
  CurlHandle curl;
  if (!curl.value) return task_lifecycle::RetryableFailure{{"LLM_CONNECTION_ERROR", "无法初始化 libcurl"}};
  if (stop_token.stop_requested()) return task_lifecycle::Obsolete{};

  const std::string request = request_payload(task).dump();
  std::string response;
  const std::string url = config_.web_internal_url + "/api/internal/llm/tasks/" + task.message.run_id + "/execute";
  curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");
  const std::string secret = "X-Alphaflow-Internal-Secret: " + config_.internal_api_secret;
  const std::string idempotency = "Idempotency-Key: " + task.input.idempotency_key;
  const std::string task_type = "X-Alphaflow-Task-Type: " + task.input.task_type;
  const std::string input_hash = "X-Alphaflow-Input-Hash: " + task.input.input_hash;
  headers = curl_slist_append(headers, secret.c_str());
  headers = curl_slist_append(headers, idempotency.c_str());
  headers = curl_slist_append(headers, task_type.c_str());
  headers = curl_slist_append(headers, input_hash.c_str());

  curl_easy_setopt(curl.value, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl.value, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(curl.value, CURLOPT_POST, 1L);
  curl_easy_setopt(curl.value, CURLOPT_POSTFIELDS, request.c_str());
  curl_easy_setopt(curl.value, CURLOPT_POSTFIELDSIZE, static_cast<long>(request.size()));
  curl_easy_setopt(curl.value, CURLOPT_WRITEFUNCTION, append_body);
  curl_easy_setopt(curl.value, CURLOPT_WRITEDATA, &response);
  curl_easy_setopt(curl.value, CURLOPT_TIMEOUT_MS, static_cast<long>(config_.request_timeout_ms));
  curl_easy_setopt(curl.value, CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(config_.connect_timeout_ms));
  curl_easy_setopt(curl.value, CURLOPT_XFERINFOFUNCTION, progress_callback);
  curl_easy_setopt(curl.value, CURLOPT_XFERINFODATA, &stop_token);
  curl_easy_setopt(curl.value, CURLOPT_NOPROGRESS, 0L);

  const CURLcode code = curl_easy_perform(curl.value);
  long status = 0;
  curl_easy_getinfo(curl.value, CURLINFO_RESPONSE_CODE, &status);
  curl_slist_free_all(headers);

  if (code != CURLE_OK) {
    if (code == CURLE_ABORTED_BY_CALLBACK && stop_token.stop_requested()) return task_lifecycle::Obsolete{};
    return task_lifecycle::RetryableFailure{{
        code == CURLE_OPERATION_TIMEDOUT ? "LLM_REQUEST_TIMEOUT" : "LLM_CONNECTION_ERROR",
        curl_easy_strerror(code)}};
  }
  if (stop_token.stop_requested()) return task_lifecycle::Obsolete{};
  if (status < 200 || status >= 300) return classify_http_failure(status, response);

  try {
    return task_lifecycle::Completed{parse_response(response, task)};
  } catch (const WorkerError& error) {
    return task_lifecycle::TerminalFailure{{error.code(), error.what()}};
  }
}

bool InternalClient::health() const {
  CurlHandle curl;
  if (!curl.value) return false;
  const std::string url = config_.web_internal_url + "/api/health/live";
  curl_easy_setopt(curl.value, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl.value, CURLOPT_WRITEFUNCTION, discard_body);
  curl_easy_setopt(curl.value, CURLOPT_TIMEOUT_MS, 3000L);
  long status = 0;
  const CURLcode code = curl_easy_perform(curl.value);
  curl_easy_getinfo(curl.value, CURLINFO_RESPONSE_CODE, &status);
  return code == CURLE_OK && status >= 200 && status < 300;
}

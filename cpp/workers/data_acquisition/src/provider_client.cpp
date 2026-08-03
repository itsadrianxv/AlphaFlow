#include "provider_client.hpp"

#include <curl/curl.h>

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
std::string body_or_default(std::string_view body) {
  return body.empty() ? "Provider 内部接口未返回错误详情" : std::string(body);
}
std::string first_error_retryability(const nlohmann::json& envelope) {
  const auto errors = envelope.value("errors", nlohmann::json::array());
  if (errors.is_array() && !errors.empty() && errors[0].is_object()) {
    return errors[0].value("retryability", "");
  }
  return {};
}
std::string first_error_class(const nlohmann::json& envelope) {
  const auto errors = envelope.value("errors", nlohmann::json::array());
  if (errors.is_array() && !errors.empty() && errors[0].is_object()) {
    return errors[0].value("errorClass", "provider_error");
  }
  return "provider_error";
}
std::string first_error_message(const nlohmann::json& envelope) {
  const auto errors = envelope.value("errors", nlohmann::json::array());
  if (errors.is_array() && !errors.empty() && errors[0].is_object()) {
    return errors[0].value("message", "Provider 返回错误结果");
  }
  return "Provider 返回错误结果";
}
}  // namespace

bool ProviderClient::retryable_http_status(long status) {
  return status == 408 || status == 429 || status >= 500;
}

nlohmann::json ProviderClient::request_payload(const AcquisitionTask& task) {
  const auto& input = task.input;
  nlohmann::json request = nlohmann::json::object();
  request["datasetKey"] = input.dataset_key;
  request["providerKey"] = input.provider_key;
  request["requestedScope"] = input.fact_scope_json;
  request["targetDataCutoff"] = {
      {"key", input.target_data_cutoff_key}, {"value", input.target_data_cutoff_json.value("value", "")}};
  request["idempotencyKey"] = input.idempotency_key;
  request["requestFingerprint"] = input.request_fingerprint;
  request["acquisitionAttemptId"] = input.attempt_id;
  request["expectedContractVersion"] = input.provider_contract_version;
  request["requestParams"] = nlohmann::json::object();
  return nlohmann::json{{"contractVersion", "1.0"},
                        {"attemptId", input.attempt_id},
                        {"workerId", ""},
                        {"fencingToken", std::to_string(task.fencing_token)},
                        {"request", request}};
}

ProviderFetchResult ProviderClient::parse_response(const std::string& body) {
  nlohmann::json envelope;
  try {
    envelope = nlohmann::json::parse(body);
  } catch (const std::exception& error) {
    throw WorkerError("INVALID_PROVIDER_RESPONSE_JSON", error.what(), false);
  }
  try {
    if (!envelope.is_object()) throw std::runtime_error("响应必须是 JSON 对象");
    const std::string version = envelope.at("contractVersion").get<std::string>();
    const auto dot = version.find('.');
    const std::string major = dot == std::string::npos ? version : version.substr(0, dot);
    if (major != "1") throw WorkerError("CONTRACT_INCOMPATIBLE", "不支持的 Provider contract 主版本: " + version, false);
    const std::string status = envelope.at("resultStatus").get<std::string>();
    if (status != "success" && status != "degraded" && status != "empty" && status != "error") {
      throw std::runtime_error("未知 resultStatus: " + status);
    }
    const std::string result_hash = envelope.value("resultHash", "");
    if (status != "error" && result_hash.rfind("sha256:", 0) != 0) {
      throw std::runtime_error("非错误结果必须携带 resultHash");
    }
    return {std::move(envelope), status, result_hash};
  } catch (const WorkerError&) {
    throw;
  } catch (const std::exception& error) {
    throw WorkerError("INVALID_PROVIDER_RESPONSE", error.what(), false);
  }
}

task_lifecycle::ExecutionResult<ProviderFetchResult> ProviderClient::classify_http_failure(
    long status, std::string_view body) {
  std::string code = "PROVIDER_HTTP_" + std::to_string(status);
  std::string message = body_or_default(body);
  bool retryable = retryable_http_status(status);
  bool obsolete = false;
  try {
    const auto payload = nlohmann::json::parse(body);
    if (payload.is_object()) {
      code = payload.value("code", code);
      message = payload.value("message", message);
      retryable = payload.value("retryable", retryable);
      obsolete = payload.value("obsolete", false);
    }
  } catch (...) {
  }
  if (obsolete) return task_lifecycle::Obsolete{};
  task_lifecycle::Failure failure{std::move(code), std::move(message)};
  if (retryable) return task_lifecycle::RetryableFailure{std::move(failure)};
  return task_lifecycle::TerminalFailure{std::move(failure)};
}

task_lifecycle::ExecutionResult<ProviderFetchResult> ProviderClient::execute(
    const AcquisitionTask& task, std::stop_token stop_token) const {
  if (stop_token.stop_requested()) return task_lifecycle::Obsolete{};
  CurlHandle curl;
  if (!curl.value) return task_lifecycle::RetryableFailure{{"PROVIDER_CONNECTION_ERROR", "无法初始化 libcurl"}};

  const std::string request = request_payload(task).dump();
  std::string response;
  const std::string url = config_.provider_internal_url + "/api/v1/homepage-provider/fetch";
  curl_slist* headers = nullptr;
  headers = curl_slist_append(headers, "Content-Type: application/json");
  const std::string secret = "X-Alphaflow-Internal-Secret: " + config_.internal_api_secret;
  headers = curl_slist_append(headers, secret.c_str());

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
        code == CURLE_OPERATION_TIMEDOUT ? "PROVIDER_REQUEST_TIMEOUT" : "PROVIDER_CONNECTION_ERROR",
        curl_easy_strerror(code)}};
  }
  if (stop_token.stop_requested()) return task_lifecycle::Obsolete{};
  if (status < 200 || status >= 300) return classify_http_failure(status, response);

  try {
    auto result = parse_response(response);
    if (result.result_status == "error") {
      const task_lifecycle::Failure failure{first_error_class(result.envelope), first_error_message(result.envelope)};
      if (first_error_retryability(result.envelope) == "retryable") {
        return task_lifecycle::RetryableFailure{failure};
      }
      return task_lifecycle::TerminalFailure{failure};
    }
    return task_lifecycle::Completed{std::move(result)};
  } catch (const WorkerError& error) {
    if (error.retryable()) return task_lifecycle::RetryableFailure{{error.code(), error.what()}};
    return task_lifecycle::TerminalFailure{{error.code(), error.what()}};
  }
}

bool ProviderClient::health() const {
  CurlHandle curl;
  if (!curl.value) return false;
  const std::string url = config_.provider_internal_url + "/health";
  curl_easy_setopt(curl.value, CURLOPT_URL, url.c_str());
  curl_easy_setopt(curl.value, CURLOPT_WRITEFUNCTION, discard_body);
  curl_easy_setopt(curl.value, CURLOPT_TIMEOUT_MS, 3000L);
  long status = 0;
  const CURLcode code = curl_easy_perform(curl.value);
  curl_easy_getinfo(curl.value, CURLINFO_RESPONSE_CODE, &status);
  return code == CURLE_OK && status >= 200 && status < 300;
}

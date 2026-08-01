#include "internal_client.hpp"
#include <curl/curl.h>

namespace {
size_t append_body(char* data,size_t size,size_t count,void* output){ static_cast<std::string*>(output)->append(data,size*count); return size*count; }
size_t discard_body(char*,size_t size,size_t count,void*){ return size*count; }
int progress_callback(void* state,curl_off_t,curl_off_t,curl_off_t,curl_off_t){ return static_cast<const std::stop_token*>(state)->stop_requested()?1:0; }
struct CurlHandle{ CURL* value{curl_easy_init()}; ~CurlHandle(){if(value)curl_easy_cleanup(value);} };
}
bool InternalClient::retryable_http_status(long status){ return status==408||status==429||status>=500; }
HomePageGenerationResult InternalClient::parse_response(const std::string& body){
  try { auto json=nlohmann::json::parse(body); auto payload=json.at("payload"); auto as_of=json.at("dataAsOf").get<std::string>(); if(!payload.is_object()||as_of.empty()) throw std::runtime_error("payload 或 dataAsOf 不合法"); return {std::move(payload),std::move(as_of)}; }
  catch(const WorkerError&){throw;} catch(const std::exception& error){throw WorkerError("INVALID_GENERATOR_RESPONSE",error.what(),false);}
}
task_lifecycle::ExecutionResult<HomePageGenerationResult> InternalClient::execute(const HomePageTask& task,std::stop_token stop_token) const{
  CurlHandle curl; if(!curl.value) return task_lifecycle::RetryableFailure{{"GENERATOR_CONNECTION_ERROR","无法初始化 libcurl"}}; std::string response;
  const std::string url=config_.web_internal_url+"/api/internal/homepage-generation/"+task.message.run_id;
  curl_slist* headers=nullptr; headers=curl_slist_append(headers,"Content-Type: application/json"); const std::string secret="X-Alphaflow-Internal-Secret: "+config_.internal_api_secret; headers=curl_slist_append(headers,secret.c_str());
  curl_easy_setopt(curl.value,CURLOPT_URL,url.c_str()); curl_easy_setopt(curl.value,CURLOPT_HTTPHEADER,headers); curl_easy_setopt(curl.value,CURLOPT_POSTFIELDS,""); curl_easy_setopt(curl.value,CURLOPT_WRITEFUNCTION,append_body); curl_easy_setopt(curl.value,CURLOPT_WRITEDATA,&response);
  curl_easy_setopt(curl.value,CURLOPT_TIMEOUT_MS,static_cast<long>(config_.request_timeout_ms)); curl_easy_setopt(curl.value,CURLOPT_CONNECTTIMEOUT_MS,10000L); curl_easy_setopt(curl.value,CURLOPT_XFERINFOFUNCTION,progress_callback); curl_easy_setopt(curl.value,CURLOPT_XFERINFODATA,&stop_token); curl_easy_setopt(curl.value,CURLOPT_NOPROGRESS,0L);
  const CURLcode code=curl_easy_perform(curl.value); long status=0; curl_easy_getinfo(curl.value,CURLINFO_RESPONSE_CODE,&status); curl_slist_free_all(headers);
  if(code!=CURLE_OK) return task_lifecycle::RetryableFailure{{code==CURLE_OPERATION_TIMEDOUT?"GENERATOR_TIMEOUT":"GENERATOR_CONNECTION_ERROR",curl_easy_strerror(code)}};
  if(status==409) return task_lifecycle::Obsolete{};
  if (status < 200 || status >= 300) {
    task_lifecycle::Failure failure{"GENERATOR_HTTP_" + std::to_string(status), response};
    if(retryable_http_status(status)) return task_lifecycle::RetryableFailure{std::move(failure)};
    return task_lifecycle::TerminalFailure{std::move(failure)};
  }
  try{return task_lifecycle::Completed{parse_response(response)};}catch(const WorkerError& error){return task_lifecycle::TerminalFailure{{error.code(),error.what()}};}
}
bool InternalClient::health() const{ CurlHandle curl; if(!curl.value)return false; const std::string url=config_.web_internal_url+"/api/health/live"; curl_easy_setopt(curl.value,CURLOPT_URL,url.c_str()); curl_easy_setopt(curl.value,CURLOPT_WRITEFUNCTION,discard_body); curl_easy_setopt(curl.value,CURLOPT_TIMEOUT_MS,3000L); const auto code=curl_easy_perform(curl.value); long status=0; curl_easy_getinfo(curl.value,CURLINFO_RESPONSE_CODE,&status); return code==CURLE_OK&&status>=200&&status<300; }

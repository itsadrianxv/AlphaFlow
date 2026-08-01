#include "config.hpp"

#include <cstdlib>
#include <random>
#include <stdexcept>
#include <string_view>
#include <unistd.h>

namespace {
std::string required_env(const char* name) { const char* value=std::getenv(name); if(!value||std::string_view(value).empty()) throw std::runtime_error(std::string(name)+" is required"); return value; }
std::string env_or(const char* name,const char* fallback){ const char* value=std::getenv(name); return value&&*value?value:fallback; }
int positive_int(const char* name,int fallback){ const char* value=std::getenv(name); const int parsed=std::stoi(value&&*value?value:std::to_string(fallback)); if(parsed<=0) throw std::runtime_error(std::string(name)+" must be positive"); return parsed; }
std::string identity(){ char host[256]{}; gethostname(host,sizeof(host)-1); std::random_device random; return std::string(host)+"-"+std::to_string(getpid())+"-"+std::to_string(random()); }
}

RedisEndpoint parse_redis_url(const std::string& url){
  constexpr std::string_view prefix="redis://"; if(!url.starts_with(prefix)) throw std::runtime_error("REDIS_URL must use redis://");
  std::string rest=url.substr(prefix.size()); RedisEndpoint result; const auto at=rest.find('@');
  if(at!=std::string::npos){ const auto credentials=rest.substr(0,at); const auto colon=credentials.find(':'); result.password=colon==std::string::npos?credentials:credentials.substr(colon+1); rest=rest.substr(at+1); }
  const auto slash=rest.find('/'); const std::string address=rest.substr(0,slash); if(slash!=std::string::npos&&slash+1<rest.size()) result.database=std::stoi(rest.substr(slash+1));
  const auto colon=address.rfind(':'); result.host=colon==std::string::npos?address:address.substr(0,colon); if(colon!=std::string::npos) result.port=std::stoi(address.substr(colon+1)); if(result.host.empty()) throw std::runtime_error("REDIS_URL host is empty"); return result;
}

Config Config::from_environment(){
  Config config; config.database_url=required_env("DATABASE_URL"); config.redis_url=required_env("REDIS_URL"); config.redis=parse_redis_url(config.redis_url);
  config.web_internal_url=required_env("ALPHAFLOW_WEB_INTERNAL_URL"); config.internal_api_secret=required_env("ALPHAFLOW_INTERNAL_API_SECRET");
  config.worker_threads=positive_int("HOMEPAGE_WORKER_THREADS",2); config.queue_capacity=positive_int("HOMEPAGE_WORKER_QUEUE_CAPACITY",4);
  config.lease_seconds=positive_int("HOMEPAGE_WORKER_LEASE_SECONDS",900); config.heartbeat_seconds=positive_int("HOMEPAGE_WORKER_HEARTBEAT_SECONDS",30);
  config.claim_idle_ms=positive_int("HOMEPAGE_WORKER_CLAIM_IDLE_MS",1200000); config.request_timeout_ms=positive_int("HOMEPAGE_WORKER_REQUEST_TIMEOUT_MS",900000);
  config.health_port=positive_int("HOMEPAGE_WORKER_HEALTH_PORT",8050); config.stream_block_ms=positive_int("HOMEPAGE_WORKER_STREAM_BLOCK_MS",5000);
  config.stream=env_or("HOMEPAGE_TASK_STREAM","homepage:generation"); config.group=env_or("HOMEPAGE_TASK_GROUP","homepage-worker"); config.worker_id=identity(); config.consumer=config.worker_id;
  if (config.heartbeat_seconds >= config.lease_seconds) {
    throw std::runtime_error("homepage heartbeat must be less than lease");
  }
  return config;
}

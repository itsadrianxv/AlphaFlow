#include "config.hpp"

#include <cstdlib>
#include <cstdio>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string_view>

#ifdef _WIN32
#include <process.h>
#define getpid _getpid
#else
#include <unistd.h>
#endif

namespace {

std::string required_env(const char* name) {
  const char* value = std::getenv(name);
  if (!value || std::string_view(value).empty()) {
    throw std::invalid_argument(std::string(name) + " is required");
  }
  return value;
}

std::string env_or(const char* name, const char* fallback) {
  const char* value = std::getenv(name);
  return value && *value ? value : fallback;
}

int positive_int(const char* name, int fallback) {
  const char* configured = std::getenv(name);
  const std::string raw = configured && *configured ? configured : std::to_string(fallback);
  std::size_t consumed = 0;
  int value = 0;
  try {
    value = std::stoi(raw, &consumed);
  } catch (const std::exception&) {
    throw std::invalid_argument(std::string(name) + " must be a positive integer");
  }
  if (consumed != raw.size() || value <= 0) {
    throw std::invalid_argument(std::string(name) + " must be a positive integer");
  }
  return value;
}

std::string trim(std::string value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

std::string identity() {
  char host[256]{};
  if (gethostname(host, sizeof(host) - 1) != 0) std::snprintf(host, sizeof(host), "llm-worker");
  std::random_device random;
  return std::string(host) + "-" + std::to_string(getpid()) + "-" + std::to_string(random());
}

}  // namespace

RedisEndpoint parse_redis_url(const std::string& url) {
  constexpr std::string_view prefix = "redis://";
  if (!url.starts_with(prefix)) throw std::invalid_argument("REDIS_URL must use redis://");

  std::string rest = url.substr(prefix.size());
  RedisEndpoint result;
  const auto at = rest.find('@');
  if (at != std::string::npos) {
    const auto credentials = rest.substr(0, at);
    const auto colon = credentials.find(':');
    result.password = colon == std::string::npos ? credentials : credentials.substr(colon + 1);
    rest = rest.substr(at + 1);
  }

  const auto slash = rest.find('/');
  const std::string address = rest.substr(0, slash);
  if (address.empty()) throw std::invalid_argument("REDIS_URL host is empty");
  if (slash != std::string::npos && slash + 1 < rest.size()) {
    std::size_t consumed = 0;
    try {
      result.database = std::stoi(rest.substr(slash + 1), &consumed);
    } catch (const std::exception&) {
      throw std::invalid_argument("REDIS_URL database is invalid");
    }
    if (consumed != rest.substr(slash + 1).size() || result.database < 0) {
      throw std::invalid_argument("REDIS_URL database is invalid");
    }
  }

  if (address.front() == '[') {
    const auto close = address.find(']');
    if (close == std::string::npos) throw std::invalid_argument("REDIS_URL host is invalid");
    result.host = address.substr(1, close - 1);
    if (close + 1 < address.size()) {
      if (address[close + 1] != ':') throw std::invalid_argument("REDIS_URL port is invalid");
      const auto port_text = address.substr(close + 2);
      std::size_t consumed = 0;
      try {
        result.port = std::stoi(port_text, &consumed);
      } catch (const std::exception&) {
        throw std::invalid_argument("REDIS_URL port is invalid");
      }
      if (consumed != port_text.size()) throw std::invalid_argument("REDIS_URL port is invalid");
    }
  } else {
    const auto colon = address.rfind(':');
    result.host = colon == std::string::npos ? address : address.substr(0, colon);
    if (colon != std::string::npos) {
      const auto port_text = address.substr(colon + 1);
      std::size_t consumed = 0;
      try {
        result.port = std::stoi(port_text, &consumed);
      } catch (const std::exception&) {
        throw std::invalid_argument("REDIS_URL port is invalid");
      }
      if (consumed != port_text.size()) throw std::invalid_argument("REDIS_URL port is invalid");
    }
  }
  if (result.host.empty() || result.port <= 0 || result.port > 65535) {
    throw std::invalid_argument("REDIS_URL host or port is invalid");
  }
  return result;
}

std::vector<std::chrono::seconds> parse_retry_delays(const std::string& value) {
  std::vector<std::chrono::seconds> result;
  std::stringstream input(value);
  std::string token;
  while (std::getline(input, token, ',')) {
    token = trim(std::move(token));
    if (token.empty()) throw std::invalid_argument("LLM_WORKER_RETRY_DELAYS_SECONDS contains an empty delay");
    std::size_t consumed = 0;
    int seconds = 0;
    try {
      seconds = std::stoi(token, &consumed);
    } catch (const std::exception&) {
      throw std::invalid_argument("LLM_WORKER_RETRY_DELAYS_SECONDS contains an invalid delay");
    }
    if (consumed != token.size() || seconds <= 0) {
      throw std::invalid_argument("LLM_WORKER_RETRY_DELAYS_SECONDS contains an invalid delay");
    }
    result.emplace_back(seconds);
  }
  if (result.empty()) throw std::invalid_argument("LLM_WORKER_RETRY_DELAYS_SECONDS must not be empty");
  return result;
}

void validate_config(const Config& config) {
  if (config.worker_threads == 0) throw std::invalid_argument("worker_threads must be positive");
  if (config.queue_capacity == 0) throw std::invalid_argument("queue_capacity must be positive");
  if (config.lease_seconds <= 0 || config.heartbeat_seconds <= 0 ||
      config.heartbeat_seconds >= config.lease_seconds) {
    throw std::invalid_argument("heartbeat_seconds must be positive and less than lease_seconds");
  }
  if (config.claim_idle_ms <= 0 || config.request_timeout_ms <= 0 || config.connect_timeout_ms <= 0 ||
      config.stream_block_ms <= 0 || config.max_attempts <= 0) {
    throw std::invalid_argument("worker timing and max_attempts must be positive");
  }
  if (config.health_port <= 0 || config.health_port > 65535) {
    throw std::invalid_argument("health_port must be between 1 and 65535");
  }
  if (config.retry_delays.empty()) throw std::invalid_argument("retry_delays must not be empty");
  for (const auto delay : config.retry_delays) {
    if (delay <= std::chrono::seconds::zero()) throw std::invalid_argument("retry_delays must be positive");
  }
}

Config Config::from_environment() {
  Config config;
  config.database_url = required_env("DATABASE_URL");
  config.redis_url = required_env("REDIS_URL");
  config.redis = parse_redis_url(config.redis_url);
  config.web_internal_url = required_env("ALPHAFLOW_WEB_INTERNAL_URL");
  config.internal_api_secret = required_env("ALPHAFLOW_INTERNAL_API_SECRET");
  config.worker_threads = static_cast<std::size_t>(positive_int("LLM_WORKER_THREADS", 8));
  config.queue_capacity = static_cast<std::size_t>(positive_int("LLM_WORKER_QUEUE_CAPACITY", 16));
  config.lease_seconds = positive_int("LLM_WORKER_LEASE_SECONDS", 900);
  config.heartbeat_seconds = positive_int("LLM_WORKER_HEARTBEAT_SECONDS", 30);
  config.claim_idle_ms = positive_int("LLM_WORKER_CLAIM_IDLE_MS", 1200000);
  config.request_timeout_ms = positive_int("LLM_WORKER_REQUEST_TIMEOUT_MS", 900000);
  config.connect_timeout_ms = positive_int("LLM_WORKER_CONNECT_TIMEOUT_MS", 10000);
  config.health_port = positive_int("LLM_WORKER_HEALTH_PORT", 8060);
  config.stream_block_ms = positive_int("LLM_WORKER_STREAM_BLOCK_MS", 5000);
  config.max_attempts = positive_int("LLM_WORKER_MAX_ATTEMPTS", 5);
  if (const char* raw_delays = std::getenv("LLM_WORKER_RETRY_DELAYS_SECONDS"); raw_delays && *raw_delays) {
    config.retry_delays = parse_retry_delays(raw_delays);
  }
  config.stream = env_or("LLM_TASK_STREAM", "llm:tasks");
  config.group = env_or("LLM_TASK_GROUP", "llm-worker");
  config.worker_id = identity();
  config.consumer = config.worker_id;
  validate_config(config);
  return config;
}

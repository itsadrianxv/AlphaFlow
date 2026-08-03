#include "config.hpp"

#include <cstdio>
#include <cstdlib>
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
  if (!value || std::string_view(value).empty()) throw std::invalid_argument(std::string(name) + " is required");
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
  } catch (...) {
    throw std::invalid_argument(std::string(name) + " must be a positive integer");
  }
  if (consumed != raw.size() || value <= 0) throw std::invalid_argument(std::string(name) + " must be a positive integer");
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
  if (gethostname(host, sizeof(host) - 1) != 0) std::snprintf(host, sizeof(host), "data-acquisition-worker");
  std::random_device random;
  return std::string(host) + "-" + std::to_string(getpid()) + "-" + std::to_string(random());
}

void validate_config(const Config& config) {
  if (config.worker_threads == 0 || config.queue_capacity == 0) throw std::invalid_argument("worker sizing must be positive");
  if (config.heartbeat_seconds <= 0 || config.lease_seconds <= 0 || config.heartbeat_seconds >= config.lease_seconds) {
    throw std::invalid_argument("heartbeat_seconds must be positive and less than lease_seconds");
  }
  if (config.claim_idle_ms <= 0 || config.request_timeout_ms <= 0 || config.connect_timeout_ms <= 0 ||
      config.stream_block_ms <= 0 || config.max_attempts <= 0) {
    throw std::invalid_argument("worker timing and max_attempts must be positive");
  }
  if (config.health_port <= 0 || config.health_port > 65535) throw std::invalid_argument("health_port must be valid");
  if (config.retry_delays.empty()) throw std::invalid_argument("retry_delays must not be empty");
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
  if (slash != std::string::npos && slash + 1 < rest.size()) result.database = std::stoi(rest.substr(slash + 1));
  const auto colon = address.rfind(':');
  result.host = colon == std::string::npos ? address : address.substr(0, colon);
  if (colon != std::string::npos) result.port = std::stoi(address.substr(colon + 1));
  if (result.host.empty() || result.port <= 0 || result.port > 65535 || result.database < 0) {
    throw std::invalid_argument("REDIS_URL host, port or database is invalid");
  }
  return result;
}

std::vector<std::chrono::seconds> parse_retry_delays(const std::string& value) {
  std::vector<std::chrono::seconds> result;
  std::stringstream input(value);
  std::string token;
  while (std::getline(input, token, ',')) {
    token = trim(std::move(token));
    if (token.empty()) throw std::invalid_argument("DATA_ACQUISITION_RETRY_DELAYS_SECONDS contains an empty delay");
    const int seconds = std::stoi(token);
    if (seconds <= 0) throw std::invalid_argument("DATA_ACQUISITION_RETRY_DELAYS_SECONDS contains an invalid delay");
    result.emplace_back(seconds);
  }
  if (result.empty()) throw std::invalid_argument("DATA_ACQUISITION_RETRY_DELAYS_SECONDS must not be empty");
  return result;
}

Config Config::from_environment() {
  Config config;
  config.database_url = required_env("DATABASE_URL");
  config.redis_url = required_env("REDIS_URL");
  config.redis = parse_redis_url(config.redis_url);
  config.provider_internal_url = required_env("PYTHON_SERVICE_URL");
  config.internal_api_secret = required_env("ALPHAFLOW_INTERNAL_API_SECRET");
  config.worker_threads = static_cast<std::size_t>(positive_int("DATA_ACQUISITION_WORKER_THREADS", 2));
  config.queue_capacity = static_cast<std::size_t>(positive_int("DATA_ACQUISITION_WORKER_QUEUE_CAPACITY", 4));
  config.lease_seconds = positive_int("DATA_ACQUISITION_WORKER_LEASE_SECONDS", 300);
  config.heartbeat_seconds = positive_int("DATA_ACQUISITION_WORKER_HEARTBEAT_SECONDS", 30);
  config.claim_idle_ms = positive_int("DATA_ACQUISITION_WORKER_CLAIM_IDLE_MS", 300000);
  config.request_timeout_ms = positive_int("DATA_ACQUISITION_WORKER_REQUEST_TIMEOUT_MS", 120000);
  config.connect_timeout_ms = positive_int("DATA_ACQUISITION_WORKER_CONNECT_TIMEOUT_MS", 10000);
  config.health_port = positive_int("DATA_ACQUISITION_WORKER_HEALTH_PORT", 8070);
  config.stream_block_ms = positive_int("DATA_ACQUISITION_WORKER_STREAM_BLOCK_MS", 5000);
  config.max_attempts = positive_int("DATA_ACQUISITION_WORKER_MAX_ATTEMPTS", 5);
  if (const char* raw = std::getenv("DATA_ACQUISITION_RETRY_DELAYS_SECONDS"); raw && *raw) {
    config.retry_delays = parse_retry_delays(raw);
  }
  config.stream = env_or("DATA_ACQUISITION_STREAM", "homepage:data-acquisition");
  config.group = env_or("DATA_ACQUISITION_GROUP", "data-acquisition-worker");
  config.worker_id = identity();
  config.consumer = config.worker_id;
  validate_config(config);
  return config;
}

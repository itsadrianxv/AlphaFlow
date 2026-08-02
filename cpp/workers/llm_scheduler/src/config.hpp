#pragma once

#include <chrono>
#include <cstddef>
#include <string>
#include <vector>

struct RedisEndpoint {
  std::string host;
  int port{6379};
  int database{0};
  std::string password;
};

struct Config {
  std::string database_url;
  std::string redis_url;
  RedisEndpoint redis;
  std::string web_internal_url;
  std::string internal_api_secret;
  std::size_t worker_threads{8};
  std::size_t queue_capacity{16};
  int lease_seconds{900};
  int heartbeat_seconds{30};
  int claim_idle_ms{1200000};
  int request_timeout_ms{900000};
  int connect_timeout_ms{10000};
  int health_port{8060};
  int stream_block_ms{5000};
  int max_attempts{5};
  std::vector<std::chrono::seconds> retry_delays{
      std::chrono::seconds(30), std::chrono::seconds(120), std::chrono::seconds(600),
      std::chrono::seconds(1800)};
  std::string stream{"llm:tasks"};
  std::string group{"llm-worker"};
  std::string consumer;
  std::string worker_id;

  static Config from_environment();
};

RedisEndpoint parse_redis_url(const std::string& url);
std::vector<std::chrono::seconds> parse_retry_delays(const std::string& value);
void validate_config(const Config& config);

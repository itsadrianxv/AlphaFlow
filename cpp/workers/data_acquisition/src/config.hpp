#pragma once

#include <chrono>
#include <cstddef>
#include <string>
#include <vector>

struct RedisEndpoint {
  std::string host{"redis"};
  int port{6379};
  int database{0};
  std::string password;
};

struct Config {
  std::string database_url;
  std::string redis_url;
  RedisEndpoint redis;
  std::string provider_internal_url;
  std::string internal_api_secret;
  std::string worker_id;
  std::string consumer;
  std::string stream{"homepage:data-acquisition"};
  std::string group{"data-acquisition-worker"};
  std::size_t worker_threads{2};
  std::size_t queue_capacity{4};
  int lease_seconds{300};
  int heartbeat_seconds{30};
  int claim_idle_ms{300000};
  int request_timeout_ms{120000};
  int connect_timeout_ms{10000};
  int health_port{8070};
  int stream_block_ms{5000};
  int max_attempts{5};
  std::vector<std::chrono::seconds> retry_delays{
      std::chrono::seconds(30), std::chrono::seconds(120), std::chrono::seconds(600),
      std::chrono::seconds(1800)};

  static Config from_environment();
};

RedisEndpoint parse_redis_url(const std::string& url);
std::vector<std::chrono::seconds> parse_retry_delays(const std::string& value);

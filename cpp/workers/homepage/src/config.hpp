#pragma once

#include <cstddef>
#include <string>

struct RedisEndpoint { std::string host; int port{6379}; int database{0}; std::string password; };

struct Config {
  std::string database_url, redis_url, web_internal_url, internal_api_secret;
  RedisEndpoint redis;
  std::size_t worker_threads{2}, queue_capacity{4};
  int lease_seconds{900}, heartbeat_seconds{30}, claim_idle_ms{1200000};
  int request_timeout_ms{900000}, health_port{8050}, stream_block_ms{5000};
  std::string stream{"homepage:generation"}, group{"homepage-worker"}, consumer, worker_id;
  static Config from_environment();
};

RedisEndpoint parse_redis_url(const std::string& url);

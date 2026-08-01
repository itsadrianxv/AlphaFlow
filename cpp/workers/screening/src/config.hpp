#pragma once

#include <cstddef>
#include <string>

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
  std::string python_service_url;
  std::size_t worker_threads{4};
  std::size_t queue_capacity{8};
  int lease_seconds{90};
  int heartbeat_seconds{30};
  int claim_idle_ms{120000};
  int python_timeout_ms{900000};
  int health_port{8030};
  int stream_block_ms{5000};
  std::string stream{"screening:runs"};
  std::string group{"screening-worker"};
  std::string consumer;
  std::string worker_id;

  static Config from_environment();
};

RedisEndpoint parse_redis_url(const std::string& url);

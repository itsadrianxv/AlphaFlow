#include <curl/curl.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <thread>

#include "config.hpp"
#include "health_server.hpp"
#include "internal_client.hpp"
#include "llm_task_repository.hpp"
#include "messaging/redis_stream_transport.hpp"
#include "task_lifecycle/worker.hpp"

namespace {

std::atomic<bool> signal_received{false};

void handle_signal(int) { signal_received.store(true); }

messaging::RedisStreamSettings stream_settings(const Config& config) {
  messaging::RedisStreamSettings settings;
  settings.host = config.redis.host;
  settings.port = config.redis.port;
  settings.database = config.redis.database;
  settings.password = config.redis.password;
  settings.stream = config.stream;
  settings.group = config.group;
  settings.consumer = config.consumer;
  settings.block_ms = config.stream_block_ms;
  settings.claim_idle_ms = config.claim_idle_ms;
  settings.llm_protocol = true;
  return settings;
}

}  // namespace

int main() {
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGINT, handle_signal);
  curl_global_init(CURL_GLOBAL_DEFAULT);
  try {
    Config config = Config::from_environment();
    auto transport = std::make_shared<messaging::RedisStreamTransport>(stream_settings(config));
    LlmTaskRepository repository(config);

    task_lifecycle::WorkerConfig runtime_config;
    runtime_config.transport = transport;
    runtime_config.worker_threads = config.worker_threads;
    runtime_config.queue_capacity = config.queue_capacity;
    runtime_config.heartbeat_interval = std::chrono::seconds(config.heartbeat_seconds);
    runtime_config.recovery_interval = std::chrono::milliseconds(250);
    runtime_config.max_attempts = config.max_attempts;
    runtime_config.retry_delays = config.retry_delays;

    auto runtime = task_lifecycle::make_worker<LlmTaskInput, LlmExecutionResult>(
        std::move(runtime_config), repository,
        [&config](const LlmTask& task, std::stop_token stop_token) {
          return InternalClient(config).execute(task, stop_token);
        });

    HealthState health;
    health.tick_ms.store(HealthServer::now_ms());
    health.postgres.store(repository.ping());
    health.redis.store(transport->ping());
    health.web.store(InternalClient(config).health());
    HealthServer health_server(config, runtime->stopping_flag(), health);
    health_server.start();

    std::thread health_tick([&] {
      while (!runtime->stopping()) {
        health.tick_ms.store(HealthServer::now_ms());
        health.postgres.store(repository.ping());
        health.redis.store(transport->ping());
        health.web.store(InternalClient(config).health());
        std::this_thread::sleep_for(std::chrono::seconds(3));
      }
    });
    std::thread signal_watcher([&] {
      while (!signal_received.load() && !runtime->stopping()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      if (signal_received.load()) runtime->request_stop();
    });

    try {
      runtime->run();
    } catch (...) {
      runtime->request_stop();
      signal_watcher.join();
      health_tick.join();
      health_server.stop();
      throw;
    }
    runtime->request_stop();
    signal_watcher.join();
    health_tick.join();
    health_server.stop();
  } catch (const std::exception& error) {
    std::cerr << "llm-scheduler 启动失败: " << error.what() << '\n';
    curl_global_cleanup();
    return 1;
  }
  curl_global_cleanup();
  return 0;
}

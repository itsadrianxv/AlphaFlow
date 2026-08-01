#include <curl/curl.h>

#include <atomic>
#include <chrono>
#include <csignal>
#include <iostream>
#include <memory>
#include <thread>

#include "config.hpp"
#include "health_server.hpp"
#include "homepage_repository.hpp"
#include "internal_client.hpp"
#include "messaging/redis_stream_transport.hpp"
#include "task_lifecycle/worker.hpp"

namespace {
std::atomic<bool> signal_received{false};
void handle_signal(int) { signal_received.store(true); }

messaging::RedisStreamSettings settings(const Config& config) {
  return {config.redis.host,
          config.redis.port,
          config.redis.database,
          config.redis.password,
          config.stream,
          config.group,
          config.consumer,
          config.stream_block_ms,
          config.claim_idle_ms,
          false};
}
}  // namespace

int main() {
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGINT, handle_signal);
  curl_global_init(CURL_GLOBAL_DEFAULT);
  try {
    Config config = Config::from_environment();
    auto transport =
        std::make_shared<messaging::RedisStreamTransport>(settings(config));
    HomePageRepository repository(config);
    task_lifecycle::WorkerConfig runtime_config;
    runtime_config.transport = transport;
    runtime_config.worker_threads = config.worker_threads;
    runtime_config.queue_capacity = config.queue_capacity;
    runtime_config.heartbeat_interval = std::chrono::seconds(config.heartbeat_seconds);
    runtime_config.max_attempts = 5;
    runtime_config.retry_delays = {std::chrono::seconds(30), std::chrono::seconds(120),
                                   std::chrono::seconds(600), std::chrono::seconds(1800)};
    auto runtime = task_lifecycle::make_worker<HomePageInput, HomePageGenerationResult>(
        std::move(runtime_config), repository,
        [&config](const HomePageTask& task, std::stop_token stop_token) {
          return InternalClient(config).execute(task, stop_token);
        });
    HealthState health;
    health.tick_ms.store(HealthServer::now_ms());
    health.postgres.store(repository.ping());
    health.redis.store(true);
    health.web.store(InternalClient(config).health());
    HealthServer server(config, runtime->stopping_flag(), health);
    server.start();
    std::thread probe([&] {
      while (!runtime->stopping()) {
        health.tick_ms.store(HealthServer::now_ms());
        health.postgres.store(repository.ping());
        health.web.store(InternalClient(config).health());
        std::this_thread::sleep_for(std::chrono::seconds(3));
      }
    });
    std::thread watcher([&] {
      while (!signal_received.load() && !runtime->stopping()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      if (signal_received.load()) {
        runtime->request_stop();
      }
    });
    runtime->run();
    runtime->request_stop();
    watcher.join();
    probe.join();
    server.stop();
  } catch (const std::exception& error) {
    std::cerr << "homepage-worker 启动失败: " << error.what() << '\n';
    curl_global_cleanup();
    return 1;
  }
  curl_global_cleanup();
  return 0;
}

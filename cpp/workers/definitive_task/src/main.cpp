#include <curl/curl.h>

#include <atomic>
#include <csignal>
#include <chrono>
#include <exception>
#include <iostream>
#include <memory>
#include <thread>

#include "config.hpp"
#include "definitive_task_repository.hpp"
#include "health_server.hpp"
#include "messaging/stream_transport.hpp"
#include "python_client.hpp"
#include "task_lifecycle/worker.hpp"
#include "messaging/redis_stream_transport.hpp"

namespace {
std::atomic<bool> signal_received{false};
void handle_signal(int) { signal_received.store(true); }

messaging::RedisStreamSettings redis_settings(const Config& config) {
  return {config.redis.host, config.redis.port, config.redis.database, config.redis.password, config.stream, config.group, config.consumer, config.stream_block_ms, config.claim_idle_ms, false};
}
}  // namespace

int main() {
  std::signal(SIGTERM, handle_signal);
  std::signal(SIGINT, handle_signal);
  curl_global_init(CURL_GLOBAL_DEFAULT);
  try {
    Config config = Config::from_environment();
    auto transport = std::make_shared<messaging::RedisStreamTransport>(redis_settings(config));
    DefinitiveTaskRepository repository(config);
    task_lifecycle::WorkerConfig runtime_config;
    runtime_config.transport = transport;
    runtime_config.worker_threads = config.worker_threads;
    runtime_config.queue_capacity = config.queue_capacity;
    runtime_config.heartbeat_interval = std::chrono::seconds(config.heartbeat_seconds);
    runtime_config.max_attempts = 3;

    auto runtime = task_lifecycle::make_worker<DefinitiveTaskInput, DefinitiveTaskExecutionResult>(
        std::move(runtime_config), repository,
        [&config](const DefinitiveTask& task, std::stop_token stop_token) {
          return PythonClient(config).execute(task, stop_token);
        });
    HealthState health;
    const auto now = HealthServer::now_ms();
    health.main_loop_ms.store(now); health.reader_ms.store(now); health.heartbeat_ms.store(now); health.pool_ms.store(now);
    health.postgres.store(true); health.redis.store(true); health.python.store(true);
    HealthServer health_server(config, runtime->stopping_flag(), health);
    health_server.start();
    std::thread health_tick([&] {
      while (!runtime->stopping()) {
        const auto current = HealthServer::now_ms();
        health.main_loop_ms.store(current); health.reader_ms.store(current); health.heartbeat_ms.store(current); health.pool_ms.store(current);
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
      }
    });
    std::thread signal_watcher([&] {
      while (!signal_received.load() && !runtime->stopping()) std::this_thread::sleep_for(std::chrono::milliseconds(100));
      if (signal_received.load()) runtime->request_stop();
    });
    runtime->run();
    runtime->request_stop();
    signal_watcher.join(); health_tick.join(); health_server.stop();
  } catch (const std::exception& error) {
    std::cerr << "definitive-task-worker 启动失败: " << error.what() << '\n';
    curl_global_cleanup();
    return 1;
  }
  curl_global_cleanup();
  return 0;
}

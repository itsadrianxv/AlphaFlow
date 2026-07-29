#include "worker_runtime.hpp"

#include <algorithm>
#include <chrono>
#include <iostream>
#include <memory>
#include <thread>

#include "python_client.hpp"
#include "redis_stream.hpp"

WorkerRuntime::WorkerRuntime(Config config)
    : config_(std::move(config)),
      queue_(config_.queue_capacity),
      repository_(config_),
      retry_coordinator_(config_, stopping_),
      pool_(config_.worker_threads, queue_, [this](RunTask task) { execute(std::move(task)); }),
      health_server_(config_, stopping_, health_state_) {
  const auto now = HealthServer::now_ms();
  health_state_.main_loop_ms.store(now);
  health_state_.reader_ms.store(now);
  health_state_.heartbeat_ms.store(now);
  health_state_.pool_ms.store(now);
}

WorkerRuntime::~WorkerRuntime() { request_stop(); }

void WorkerRuntime::run() {
  pool_.start();
  retry_coordinator_.start();
  health_server_.start();
  reader_thread_ = std::thread([this] { reader_loop(); });
  recovery_thread_ = std::thread([this] { recovery_loop(); });
  heartbeat_thread_ = std::thread([this] { heartbeat_loop(); });
  probe_thread_ = std::thread([this] { dependency_probe_loop(); });
  while (!stopping_.load()) {
    const auto now = HealthServer::now_ms();
    health_state_.main_loop_ms.store(now);
    health_state_.pool_ms.store(now);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
  }
}

void WorkerRuntime::request_stop() {
  if (!stopping_.exchange(true)) queue_.close(true);
  if (reader_thread_.joinable()) reader_thread_.join();
  if (recovery_thread_.joinable()) recovery_thread_.join();
  if (heartbeat_thread_.joinable()) heartbeat_thread_.join();
  if (probe_thread_.joinable()) probe_thread_.join();
  retry_coordinator_.stop();
  pool_.join();
  health_server_.stop();
}

void WorkerRuntime::add_lease(const RunTask& task) {
  std::lock_guard lock(leases_mutex_);
  leases_[task.message.run_id] = task.fencing_token;
}

void WorkerRuntime::remove_lease(const RunTask& task) {
  std::lock_guard lock(leases_mutex_);
  const auto found = leases_.find(task.message.run_id);
  if (found != leases_.end() && found->second == task.fencing_token) leases_.erase(found);
}

std::vector<std::pair<std::string, std::int64_t>> WorkerRuntime::lease_snapshot() const {
  std::lock_guard lock(leases_mutex_);
  return {leases_.begin(), leases_.end()};
}

void WorkerRuntime::handle_message(const StreamMessage& message) {
  try {
    auto claim = repository_.claim(message);
    if (claim.status == ClaimStatus::terminal || claim.status == ClaimStatus::missing) {
      RedisStream(config_).ack_delete(message.message_id);
      return;
    }
    if (claim.status != ClaimStatus::claimed) return;
    add_lease(claim.task);
    if (!queue_.push(std::move(claim.task))) {
      std::lock_guard lock(leases_mutex_);
      leases_.erase(message.run_id);
    }
  } catch (const std::exception& error) {
    std::cerr << "领取筛选任务失败 " << message.run_id << ": " << error.what() << '\n';
  }
}

void WorkerRuntime::reader_loop() {
  while (!stopping_.load()) {
    try {
      RedisStream redis(config_);
      redis.ensure_group();
      while (!stopping_.load()) {
        if (recovery_waiting_.load()) {
          std::this_thread::sleep_for(std::chrono::milliseconds(10));
          continue;
        }
        bool queue_full = false;
        {
          // reader 与 PEL recovery 必须共享容量判定，否则两者会同时超额领取 lease。
          std::lock_guard ingress_lock(ingress_mutex_);
          const auto capacity = queue_.remaining_capacity();
          queue_full = capacity == 0;
          if (!queue_full) {
            for (const auto& message : redis.read(capacity)) handle_message(message);
          }
        }
        if (queue_full) {
          std::this_thread::sleep_for(std::chrono::milliseconds(50));
          continue;
        }
        health_state_.reader_ms.store(HealthServer::now_ms());
      }
    } catch (const std::exception& error) {
      std::cerr << "Stream reader 连接失败: " << error.what() << '\n';
      health_state_.redis.store(false);
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }
}

void WorkerRuntime::recovery_loop() {
  while (!stopping_.load()) {
    try {
      RedisStream redis(config_);
      redis.ensure_group();
      while (!stopping_.load()) {
        recovery_waiting_.store(true);
        try {
          {
            std::lock_guard ingress_lock(ingress_mutex_);
            const auto capacity = queue_.remaining_capacity();
            if (capacity > 0) {
              for (const auto& message : redis.auto_claim(capacity)) handle_message(message);
            }
          }
          recovery_waiting_.store(false);
        } catch (...) {
          recovery_waiting_.store(false);
          throw;
        }
        for (int index = 0; index < 10 && !stopping_.load(); ++index) std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
    } catch (const std::exception& error) {
      std::cerr << "PEL recovery 连接失败: " << error.what() << '\n';
      std::this_thread::sleep_for(std::chrono::seconds(1));
    }
  }
}

void WorkerRuntime::heartbeat_loop() {
  while (!stopping_.load()) {
    try {
      const auto snapshot = lease_snapshot();
      const auto renewed = repository_.heartbeat(snapshot);
      for (const auto& lease : snapshot) {
        if (std::find(renewed.begin(), renewed.end(), lease) == renewed.end()) {
          std::lock_guard lock(leases_mutex_);
          const auto found = leases_.find(lease.first);
          if (found != leases_.end() && found->second == lease.second) leases_.erase(found);
        }
      }
      health_state_.heartbeat_ms.store(HealthServer::now_ms());
    } catch (const std::exception& error) {
      std::cerr << "lease 续租失败: " << error.what() << '\n';
      health_state_.postgres.store(false);
    }
    for (int index = 0; index < config_.heartbeat_seconds * 10 && !stopping_.load(); ++index) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
  }
}

void WorkerRuntime::dependency_probe_loop() {
  PythonClient python(config_, stopping_);
  while (!stopping_.load()) {
    health_state_.postgres.store(repository_.ping());
    try {
      RedisStream redis(config_);
      health_state_.redis.store(redis.ping());
    } catch (...) {
      health_state_.redis.store(false);
    }
    health_state_.python.store(python.health());
    for (int index = 0; index < 50 && !stopping_.load(); ++index) std::this_thread::sleep_for(std::chrono::milliseconds(100));
  }
}

void WorkerRuntime::execute(RunTask task) {
  PythonClient python(config_, stopping_);
  ScreeningExecutionResult result;
  try {
    result = python.execute(task);
  } catch (const WorkerError& error) {
    std::cerr << "筛选任务失败 " << task.message.run_id << " [" << error.code() << "]: " << error.what() << '\n';
    if (stopping_.load()) {
      remove_lease(task);
      return;
    }
    try {
      if (error.retryable() && task.attempt <= 3) {
        const int delay = RetryCoordinator::delay_for_attempt(task.attempt);
        if (repository_.schedule_retry(task, error, delay)) {
          remove_lease(task);
          retry_coordinator_.schedule(task.message, delay);
        }
        return;
      }
      if (repository_.mark_failed(task, error)) {
        remove_lease(task);
        RedisStream(config_).ack_delete(task.message.message_id);
      }
      return;
    } catch (const std::exception& persistence_error) {
      std::cerr << "记录任务失败状态失败 " << task.message.run_id << ": " << persistence_error.what() << '\n';
      remove_lease(task);
      return;
    }
  } catch (const std::exception& error) {
    std::cerr << "筛选任务内部错误 " << task.message.run_id << ": " << error.what() << '\n';
    WorkerError wrapped("WORKER_INTERNAL_ERROR", error.what(), true);
    try {
      if (task.attempt <= 3 && repository_.schedule_retry(task, wrapped, RetryCoordinator::delay_for_attempt(task.attempt))) {
        remove_lease(task);
        retry_coordinator_.schedule(task.message, RetryCoordinator::delay_for_attempt(task.attempt));
      }
    } catch (...) {
      remove_lease(task);
    }
    return;
  }

  try {
    repository_.commit_result(task, result);
  } catch (const std::exception& error) {
    std::cerr << "结果事务提交失败 " << task.message.run_id << ": " << error.what() << '\n';
    remove_lease(task);
    return;
  }
  remove_lease(task);
  try {
    RedisStream(config_).ack_delete(task.message.message_id);
  } catch (const std::exception& error) {
    std::cerr << "结果已提交但 ACK 失败 " << task.message.run_id << ": " << error.what() << '\n';
  }
}

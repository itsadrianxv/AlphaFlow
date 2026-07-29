#include "retry_coordinator.hpp"

#include <chrono>
#include <iostream>

#include "redis_stream.hpp"

RetryCoordinator::~RetryCoordinator() { stop(); }

int RetryCoordinator::delay_for_attempt(int attempt) {
  if (attempt <= 1) return 10;
  if (attempt == 2) return 30;
  return 90;
}

void RetryCoordinator::start() {
  if (!thread_.joinable()) thread_ = std::thread([this] { run(); });
}

void RetryCoordinator::schedule(StreamMessage message, int delay_seconds) {
  {
    std::lock_guard lock(mutex_);
    tasks_.push({std::move(message), std::chrono::steady_clock::now() + std::chrono::seconds(delay_seconds)});
  }
  changed_.notify_one();
}

void RetryCoordinator::stop() {
  changed_.notify_all();
  if (thread_.joinable()) thread_.join();
}

void RetryCoordinator::run() {
  std::unique_ptr<RedisStream> redis;
  while (!stopping_.load()) {
    RetryTask task;
    {
      std::unique_lock lock(mutex_);
      changed_.wait(lock, [this] { return stopping_.load() || !tasks_.empty(); });
      if (stopping_.load()) break;
      const auto due = tasks_.top().due_at;
      if (changed_.wait_until(lock, due, [this, due] { return stopping_.load() || tasks_.empty() || tasks_.top().due_at < due; })) continue;
      if (stopping_.load() || tasks_.empty()) continue;
      task = tasks_.top();
      tasks_.pop();
    }
    try {
      if (!redis) redis = std::make_unique<RedisStream>(config_);
      StreamMessage replacement = task.message;
      replacement.message_id.clear();
      redis->publish(replacement);
      redis->ack_delete(task.message.message_id);
    } catch (const std::exception& error) {
      std::cerr << "重试消息替换失败: " << error.what() << '\n';
      redis.reset();
      schedule(std::move(task.message), 1);
    }
  }
}

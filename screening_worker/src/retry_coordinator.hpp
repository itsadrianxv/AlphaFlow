#pragma once

#include <atomic>
#include <condition_variable>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

#include "config.hpp"
#include "types.hpp"

class RetryCoordinator {
 public:
  RetryCoordinator(const Config& config, const std::atomic<bool>& stopping)
      : config_(config), stopping_(stopping) {}
  ~RetryCoordinator();

  void start();
  void schedule(StreamMessage message, int delay_seconds);
  void stop();
  static int delay_for_attempt(int attempt);

 private:
  struct Later {
    bool operator()(const RetryTask& left, const RetryTask& right) const { return left.due_at > right.due_at; }
  };
  void run();

  const Config& config_;
  const std::atomic<bool>& stopping_;
  std::mutex mutex_;
  std::condition_variable changed_;
  std::priority_queue<RetryTask, std::vector<RetryTask>, Later> tasks_;
  std::thread thread_;
};

#pragma once

#include <atomic>
#include <cstddef>
#include <functional>
#include <thread>
#include <vector>

#include "blocking_queue.hpp"
#include "types.hpp"

class ThreadPool {
 public:
  using Handler = std::function<void(RunTask)>;

  ThreadPool(std::size_t size, BlockingQueue<RunTask>& queue, Handler handler);
  ~ThreadPool();

  ThreadPool(const ThreadPool&) = delete;
  ThreadPool& operator=(const ThreadPool&) = delete;

  void start();
  void join();
  std::size_t active_count() const { return active_count_.load(); }
  std::chrono::steady_clock::time_point last_progress() const;

 private:
  void run();

  std::size_t size_;
  BlockingQueue<RunTask>& queue_;
  Handler handler_;
  std::vector<std::thread> threads_;
  std::atomic<std::size_t> active_count_{0};
  std::atomic<std::int64_t> last_progress_ms_{0};
};


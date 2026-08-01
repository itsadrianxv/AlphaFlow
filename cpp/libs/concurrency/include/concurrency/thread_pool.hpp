#pragma once

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <thread>
#include <utility>
#include <vector>

#include "concurrency/blocking_queue.hpp"

namespace concurrency {

template <typename T>
class ThreadPool {
 public:
  using Handler = std::function<void(T)>;
  ThreadPool(std::size_t size, BlockingQueue<T>& queue, Handler handler)
      : size_(size), queue_(queue), handler_(std::move(handler)) {}
  ~ThreadPool() { join(); }
  ThreadPool(const ThreadPool&) = delete;
  ThreadPool& operator=(const ThreadPool&) = delete;

  void start() {
    if (!threads_.empty()) return;
    for (std::size_t i = 0; i < size_; ++i) threads_.emplace_back([this] { run(); });
  }
  void join() {
    for (auto& thread : threads_) if (thread.joinable()) thread.join();
    threads_.clear();
  }
  std::size_t active_count() const { return active_count_.load(); }
  std::chrono::steady_clock::time_point last_progress() const {
    return std::chrono::steady_clock::time_point(std::chrono::milliseconds(last_progress_ms_.load()));
  }

 private:
  void run() {
    while (auto value = queue_.pop()) {
      active_count_.fetch_add(1);
      last_progress_ms_.store(std::chrono::duration_cast<std::chrono::milliseconds>(
          std::chrono::steady_clock::now().time_since_epoch()).count());
      try { handler_(std::move(*value)); } catch (...) {}
      active_count_.fetch_sub(1);
    }
  }

  std::size_t size_;
  BlockingQueue<T>& queue_;
  Handler handler_;
  std::vector<std::thread> threads_;
  std::atomic<std::size_t> active_count_{0};
  std::atomic<std::int64_t> last_progress_ms_{0};
};

}  // namespace concurrency

#include "thread_pool.hpp"

#include <chrono>
#include <exception>
#include <iostream>
#include <stdexcept>

namespace {
std::int64_t monotonic_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
}  // namespace

ThreadPool::ThreadPool(std::size_t size, BlockingQueue<RunTask>& queue, Handler handler)
    : size_(size), queue_(queue), handler_(std::move(handler)), last_progress_ms_(monotonic_ms()) {
  if (size == 0) throw std::invalid_argument("thread pool size must be positive");
}

ThreadPool::~ThreadPool() { join(); }

void ThreadPool::start() {
  if (!threads_.empty()) return;
  threads_.reserve(size_);
  for (std::size_t index = 0; index < size_; ++index) threads_.emplace_back([this] { run(); });
}

void ThreadPool::join() {
  for (auto& thread : threads_) {
    if (thread.joinable()) thread.join();
  }
  threads_.clear();
}

std::chrono::steady_clock::time_point ThreadPool::last_progress() const {
  return std::chrono::steady_clock::time_point(std::chrono::milliseconds(last_progress_ms_.load()));
}

void ThreadPool::run() {
  while (auto task = queue_.pop()) {
    active_count_.fetch_add(1);
    try {
      handler_(std::move(*task));
    } catch (const std::exception& error) {
      std::cerr << "执行线程未处理异常: " << error.what() << '\n';
    } catch (...) {
      std::cerr << "执行线程出现未知异常\n";
    }
    active_count_.fetch_sub(1);
    last_progress_ms_.store(monotonic_ms());
  }
}


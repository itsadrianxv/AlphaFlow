#include "task_runtime/runtime.hpp"

#include <chrono>
#include <algorithm>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>
#include <queue>

#include "concurrency/blocking_queue.hpp"

namespace task_runtime {
namespace {
int retry_delay(int attempt) {
  if (attempt <= 1) return 10;
  if (attempt == 2) return 30;
  return 90;
}
}

class WorkerRuntime::Impl {
 public:
  Impl(RuntimeConfig config, WorkerDefinition definition, std::shared_ptr<messaging::StreamTransport> transport, std::atomic<bool>& stopping)
      : config_(std::move(config)), definition_(std::move(definition)), transport_(std::move(transport)), stopping_(stopping), queue_(config_.queue_capacity) {
    if (!transport_) throw std::invalid_argument("stream transport is required");
    if (!definition_.claim || !definition_.execute || !definition_.commit) throw std::invalid_argument("worker callbacks are incomplete");
  }

  void run() {
    std::lock_guard lock(lifecycle_mutex_);
    if (started_) throw std::logic_error("worker runtime can only run once");
    started_ = true;
    transport_->ensure_group();
    for (std::size_t i = 0; i < config_.worker_threads; ++i) workers_.emplace_back([this] { worker_loop(); });
    reader_ = std::thread([this] { reader_loop(false); });
    recovery_ = std::thread([this] { reader_loop(true); });
    heartbeat_ = std::thread([this] { heartbeat_loop(); });
    probe_ = std::thread([this] { probe_loop(); });
    retry_ = std::thread([this] { retry_loop(); });
    while (!stopping_.load()) std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }

  void stop() {
    if (!stopping_.exchange(true)) queue_.close(true);
    if (reader_.joinable()) reader_.join();
    if (recovery_.joinable()) recovery_.join();
    if (heartbeat_.joinable()) heartbeat_.join();
    if (probe_.joinable()) probe_.join();
    retry_changed_.notify_all();
    if (retry_.joinable()) retry_.join();
    for (auto& worker : workers_) if (worker.joinable()) worker.join();
    workers_.clear();
  }

 private:
  void reader_loop(bool recovery) {
    auto transport = transport_->clone();
    transport->ensure_group();
    while (!stopping_.load()) {
      try {
        {
          std::lock_guard ingress_lock(ingress_mutex_);
          const auto capacity = queue_.remaining_capacity();
          if (capacity > 0) {
            auto messages = recovery ? transport->auto_claim(capacity) : transport->read(capacity);
            for (const auto& message : messages) handle_message(message, *transport);
          }
        }
      } catch (const std::exception& error) {
        std::cerr << (recovery ? "PEL recovery" : "stream reader") << " failed: " << error.what() << '\n';
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(recovery ? config_.recovery_interval_ms : 10));
    }
  }

  void handle_message(const StreamMessage& message, messaging::StreamTransport& transport) {
    try {
      const auto claim = definition_.claim(message);
      if (claim.status == ClaimStatus::terminal || claim.status == ClaimStatus::missing) { transport.ack_delete(message.message_id); return; }
      if (claim.status != ClaimStatus::claimed) return;
      { std::lock_guard lock(leases_mutex_); leases_[claim.task.message.run_id] = claim.task.fencing_token; }
      if (!queue_.push(claim.task)) { std::lock_guard lock(leases_mutex_); leases_.erase(claim.task.message.run_id); }
    } catch (const std::exception& error) { std::cerr << "claim failed: " << error.what() << '\n'; }
  }

  void worker_loop() {
    auto transport = transport_->clone();
    while (auto task = queue_.pop()) {
      try {
        const auto result = definition_.execute(*task);
        definition_.commit(*task, result);
        remove_lease(*task);
        transport->ack_delete(task->message.message_id);
      } catch (const WorkerError& error) {
        handle_error(*task, error, *transport);
      } catch (const std::exception& error) {
        WorkerError wrapped("WORKER_INTERNAL_ERROR", error.what(), true);
        handle_error(*task, wrapped, *transport);
      }
    }
  }

  void handle_error(const RunTask& task, const WorkerError& error, messaging::StreamTransport& transport) {
    remove_lease(task);
    if (stopping_.load()) return;
    try {
      if (error.retryable() && task.attempt < config_.max_attempts && definition_.schedule_retry) {
        const int delay = retry_delay(task.attempt);
        definition_.schedule_retry(task, error, delay);
        if (definition_.republish) {
          std::lock_guard lock(retry_mutex_);
          retries_.push({task, std::chrono::steady_clock::now() + std::chrono::seconds(delay)});
          retry_changed_.notify_one();
        }
      } else if (definition_.mark_failed) {
        definition_.mark_failed(task, error);
        transport.ack_delete(task.message.message_id);
      }
    } catch (const std::exception& persistence_error) {
      std::cerr << "task error handling failed: " << persistence_error.what() << '\n';
    }
  }

  void remove_lease(const RunTask& task) {
    std::lock_guard lock(leases_mutex_);
    const auto found = leases_.find(task.message.run_id);
    if (found != leases_.end() && found->second == task.fencing_token) leases_.erase(found);
  }

  void heartbeat_loop() {
    while (!stopping_.load()) {
      std::vector<std::pair<std::string, std::int64_t>> snapshot;
      { std::lock_guard lock(leases_mutex_); snapshot.assign(leases_.begin(), leases_.end()); }
      if (definition_.heartbeat) {
        try {
          const auto renewed = definition_.heartbeat(snapshot);
          std::lock_guard lock(leases_mutex_);
          for (const auto& lease : snapshot) {
            if (std::find(renewed.begin(), renewed.end(), lease) == renewed.end()) {
              const auto found = leases_.find(lease.first);
              if (found != leases_.end() && found->second == lease.second) leases_.erase(found);
            }
          }
        } catch (const std::exception& error) { std::cerr << "heartbeat failed: " << error.what() << '\n'; }
      }
      std::this_thread::sleep_for(std::chrono::seconds(config_.heartbeat_seconds));
    }
  }

  void probe_loop() {
    auto transport = transport_->clone();
    while (!stopping_.load()) {
      if (definition_.ping) { try { definition_.ping(); } catch (...) {} }
      try { transport->ping(); } catch (...) {}
      std::this_thread::sleep_for(std::chrono::milliseconds(config_.probe_interval_ms));
    }
  }

  struct RetryItem {
    RunTask task;
    std::chrono::steady_clock::time_point due_at;
    bool operator>(const RetryItem& other) const { return due_at > other.due_at; }
  };

  void retry_loop() {
    while (!stopping_.load()) {
      RetryItem item;
      {
        std::unique_lock lock(retry_mutex_);
        retry_changed_.wait(lock, [this] { return stopping_.load() || !retries_.empty(); });
        if (stopping_.load()) return;
        const auto due = retries_.top().due_at;
        if (retry_changed_.wait_until(lock, due, [this, due] {
              return stopping_.load() || retries_.empty() || retries_.top().due_at < due;
            })) continue;
        if (stopping_.load()) return;
        item = retries_.top();
        retries_.pop();
      }
      try {
        definition_.republish(item.task);
      } catch (const std::exception& error) {
        std::cerr << "retry republish failed: " << error.what() << '\n';
        if (!stopping_.load()) {
          std::lock_guard lock(retry_mutex_);
          retries_.push({item.task, std::chrono::steady_clock::now() + std::chrono::seconds(1)});
          retry_changed_.notify_one();
        }
      }
    }
  }

  RuntimeConfig config_;
  WorkerDefinition definition_;
  std::shared_ptr<messaging::StreamTransport> transport_;
  std::atomic<bool>& stopping_;
  concurrency::BlockingQueue<RunTask> queue_;
  std::mutex lifecycle_mutex_;
  std::mutex ingress_mutex_;
  std::mutex leases_mutex_;
  std::unordered_map<std::string, std::int64_t> leases_;
  bool started_{false};
  std::vector<std::thread> workers_;
  std::thread reader_, recovery_, heartbeat_, probe_;
  std::thread retry_;
  std::mutex retry_mutex_;
  std::condition_variable retry_changed_;
  std::priority_queue<RetryItem, std::vector<RetryItem>, std::greater<RetryItem>> retries_;
};

WorkerRuntime::WorkerRuntime(RuntimeConfig config, WorkerDefinition definition, std::shared_ptr<messaging::StreamTransport> transport)
    : impl_(std::make_unique<Impl>(std::move(config), std::move(definition), std::move(transport), stopping_)) {}
WorkerRuntime::~WorkerRuntime() { request_stop(); }
void WorkerRuntime::run() { impl_->run(); }
void WorkerRuntime::request_stop() { impl_->stop(); }

}  // namespace task_runtime

#pragma once

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <concepts>
#include <iostream>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <stop_token>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "concurrency/blocking_queue.hpp"
#include "messaging/stream_transport.hpp"
#include "task_lifecycle/types.hpp"

namespace task_lifecycle {

struct WorkerConfig {
  std::shared_ptr<messaging::StreamTransport> transport;
  std::size_t worker_threads{1};
  std::size_t queue_capacity{1};
  std::chrono::milliseconds heartbeat_interval{30000};
  std::chrono::milliseconds recovery_interval{1000};
  int max_attempts{3};
  std::vector<std::chrono::seconds> retry_delays{
      std::chrono::seconds(10), std::chrono::seconds(30), std::chrono::seconds(90)};
};

class Worker {
 public:
  virtual ~Worker() = default;
  virtual void run() = 0;
  virtual void request_stop() = 0;
  virtual bool stopping() const = 0;
  virtual const std::atomic<bool>& stopping_flag() const = 0;
};

namespace detail {

template <typename Input>
struct QueuedTask {
  Task<Input> task;
  std::shared_ptr<std::stop_source> stop_source;
};

template <typename Repository, typename Executor, typename Input, typename Result>
class TypedLifecycleWorker final : public Worker {
 public:
  TypedLifecycleWorker(WorkerConfig config, Repository repository, Executor executor)
      : config_(std::move(config)), repository_(std::move(repository)), executor_(std::move(executor)),
        queue_(config_.queue_capacity) {
    if (!config_.transport) throw std::invalid_argument("stream transport is required");
    if (config_.worker_threads == 0) throw std::invalid_argument("worker_threads must be positive");
    if (config_.max_attempts <= 0) throw std::invalid_argument("max_attempts must be positive");
  }

  ~TypedLifecycleWorker() override { request_stop(); }

  void run() override {
    std::lock_guard lock(lifecycle_mutex_);
    if (started_) throw std::logic_error("worker can only run once");
    started_ = true;
    config_.transport->ensure_group();
    for (std::size_t index = 0; index < config_.worker_threads; ++index) {
      workers_.emplace_back([this] { worker_loop(); });
    }
    reader_ = std::thread([this] { reader_loop(false); });
    recovery_ = std::thread([this] { reader_loop(true); });
    heartbeat_ = std::thread([this] { heartbeat_loop(); });
    std::unique_lock wait_lock(stop_mutex_);
    stop_changed_.wait(wait_lock, [this] { return stopping_.load(); });
  }

  void request_stop() override {
    std::lock_guard join_lock(join_mutex_);
    if (!stopping_.exchange(true)) {
      request_all_task_stops();
      queue_.close(true);
      stop_changed_.notify_all();
    }
    if (reader_.joinable()) reader_.join();
    if (recovery_.joinable()) recovery_.join();
    if (heartbeat_.joinable()) heartbeat_.join();
    for (auto& worker : workers_) if (worker.joinable()) worker.join();
    workers_.clear();
  }

  bool stopping() const override { return stopping_.load(); }
  const std::atomic<bool>& stopping_flag() const override { return stopping_; }

 private:
  void reader_loop(bool recovery) {
    auto transport = config_.transport->clone();
    transport->ensure_group();
    while (!stopping_.load()) {
      try {
        std::lock_guard ingress_lock(ingress_mutex_);
        const auto capacity = queue_.remaining_capacity();
        if (capacity > 0) {
          const auto messages = recovery ? transport->auto_claim(capacity) : transport->read(capacity);
          for (const auto& message : messages) handle_message(message, *transport);
        }
      } catch (const std::exception& error) {
        std::cerr << (recovery ? "PEL recovery" : "stream reader") << " failed: " << error.what() << '\n';
      }
      interruptible_wait(recovery ? config_.recovery_interval : std::chrono::milliseconds(10));
    }
  }

  void handle_message(const StreamMessage& message, messaging::StreamTransport& transport) {
    try {
      auto claim = repository_.claim(message);
      if (claim.disposition == ClaimDisposition::discard) {
        transport.ack_delete(message.message_id);
        return;
      }
      if (claim.disposition == ClaimDisposition::defer) return;
      if (!claim.task) throw std::logic_error("claimed result must contain a task");
      auto source = std::make_shared<std::stop_source>();
      const Lease lease{claim.task->message.run_id, claim.task->fencing_token};
      {
        std::lock_guard lock(active_mutex_);
        active_[lease.task_id] = {lease.fencing_token, source};
      }
      if (!queue_.push({std::move(*claim.task), source})) remove_active(lease);
    } catch (const std::exception& error) {
      std::cerr << "claim failed: " << error.what() << '\n';
    }
  }

  void worker_loop() {
    auto transport = config_.transport->clone();
    while (auto queued = queue_.pop()) {
      const Lease lease{queued->task.message.run_id, queued->task.fencing_token};
      std::optional<ExecutionResult<Result>> result;
      try {
        result = executor_(queued->task, queued->stop_source->get_token());
      } catch (const std::exception& error) {
        result = RetryableFailure{Failure{"WORKER_INTERNAL_ERROR", error.what()}};
      }
      if (result && !queued->stop_source->stop_requested()) {
        try {
          settle(queued->task, std::move(*result), *transport);
        } catch (const LeaseLost&) {
          queued->stop_source->request_stop();
        } catch (const std::exception& error) {
          std::cerr << "task settlement failed: " << error.what() << '\n';
        }
      }
      remove_active(lease);
    }
  }

  void settle(const Task<Input>& task, ExecutionResult<Result> result,
              messaging::StreamTransport& transport) {
    bool acknowledge = true;
    if (auto* completed = std::get_if<Completed<Result>>(&result)) {
      repository_.settle(task, Settlement<Result>::completed(std::move(completed->result)));
    } else if (auto* retryable = std::get_if<RetryableFailure>(&result)) {
      if (task.attempt < config_.max_attempts) {
        acknowledge = false;
        repository_.settle(task, Settlement<Result>::retry(
            std::move(retryable->failure), retry_delay(task.attempt)));
      } else {
        repository_.settle(task, Settlement<Result>::terminal(std::move(retryable->failure)));
      }
    } else if (auto* terminal = std::get_if<TerminalFailure>(&result)) {
      repository_.settle(task, Settlement<Result>::terminal(std::move(terminal->failure)));
    } else {
      repository_.settle(task, Settlement<Result>::obsolete());
    }
    if (acknowledge) transport.ack_delete(task.message.message_id);
  }

  std::chrono::seconds retry_delay(int attempt) const {
    if (config_.retry_delays.empty()) return std::chrono::seconds(10);
    const auto index = static_cast<std::size_t>(std::max(0, attempt - 1));
    return config_.retry_delays[std::min(index, config_.retry_delays.size() - 1)];
  }

  void heartbeat_loop() {
    while (!stopping_.load()) {
      const auto snapshot = active_snapshot();
      if (!snapshot.empty()) {
        try {
          const auto renewed = repository_.renew(snapshot);
          for (const auto& lease : snapshot) {
            if (std::find(renewed.begin(), renewed.end(), lease) == renewed.end()) cancel(lease);
          }
        } catch (const std::exception& error) {
          std::cerr << "heartbeat failed: " << error.what() << '\n';
        }
      }
      interruptible_wait(config_.heartbeat_interval);
    }
  }

  std::vector<Lease> active_snapshot() const {
    std::vector<Lease> result;
    std::lock_guard lock(active_mutex_);
    result.reserve(active_.size());
    for (const auto& [task_id, active] : active_) result.push_back({task_id, active.fencing_token});
    return result;
  }

  void cancel(const Lease& lease) {
    std::lock_guard lock(active_mutex_);
    const auto found = active_.find(lease.task_id);
    if (found != active_.end() && found->second.fencing_token == lease.fencing_token) {
      found->second.stop_source->request_stop();
    }
  }

  void remove_active(const Lease& lease) {
    std::lock_guard lock(active_mutex_);
    const auto found = active_.find(lease.task_id);
    if (found != active_.end() && found->second.fencing_token == lease.fencing_token) active_.erase(found);
  }

  void request_all_task_stops() {
    std::lock_guard lock(active_mutex_);
    for (const auto& [_, active] : active_) active.stop_source->request_stop();
  }

  void interruptible_wait(std::chrono::milliseconds duration) {
    std::unique_lock lock(stop_mutex_);
    stop_changed_.wait_for(lock, duration, [this] { return stopping_.load(); });
  }

  struct ActiveTask {
    std::int64_t fencing_token;
    std::shared_ptr<std::stop_source> stop_source;
  };

  WorkerConfig config_;
  Repository repository_;
  Executor executor_;
  concurrency::BlockingQueue<QueuedTask<Input>> queue_;
  std::atomic<bool> stopping_{false};
  bool started_{false};
  std::mutex lifecycle_mutex_;
  std::mutex join_mutex_;
  std::mutex ingress_mutex_;
  mutable std::mutex active_mutex_;
  std::unordered_map<std::string, ActiveTask> active_;
  std::vector<std::thread> workers_;
  std::thread reader_;
  std::thread recovery_;
  std::thread heartbeat_;
  std::mutex stop_mutex_;
  std::condition_variable stop_changed_;
};

}  // namespace detail

template <typename Input, typename Result, typename Repository, typename Executor>
std::unique_ptr<Worker> make_worker(WorkerConfig config, Repository repository, Executor executor) {
  return std::make_unique<detail::TypedLifecycleWorker<Repository, Executor, Input, Result>>(
      std::move(config), std::move(repository), std::move(executor));
}

}  // namespace task_lifecycle

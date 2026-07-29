#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

#include "blocking_queue.hpp"
#include "config.hpp"
#include "health_server.hpp"
#include "retry_coordinator.hpp"
#include "screening_repository.hpp"
#include "thread_pool.hpp"
#include "types.hpp"

class WorkerRuntime {
 public:
  explicit WorkerRuntime(Config config);
  ~WorkerRuntime();

  void run();
  void request_stop();
  bool stopping() const { return stopping_.load(); }

 private:
  void reader_loop();
  void recovery_loop();
  void heartbeat_loop();
  void dependency_probe_loop();
  void handle_message(const StreamMessage& message);
  void execute(RunTask task);
  void add_lease(const RunTask& task);
  void remove_lease(const RunTask& task);
  std::vector<std::pair<std::string, std::int64_t>> lease_snapshot() const;

  Config config_;
  std::atomic<bool> stopping_{false};
  BlockingQueue<RunTask> queue_;
  ScreeningRepository repository_;
  RetryCoordinator retry_coordinator_;
  ThreadPool pool_;
  HealthState health_state_;
  HealthServer health_server_;
  std::atomic<bool> recovery_waiting_{false};
  std::mutex ingress_mutex_;
  mutable std::mutex leases_mutex_;
  std::unordered_map<std::string, std::int64_t> leases_;
  std::thread reader_thread_;
  std::thread recovery_thread_;
  std::thread heartbeat_thread_;
  std::thread probe_thread_;
};

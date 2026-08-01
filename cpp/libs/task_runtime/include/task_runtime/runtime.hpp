#pragma once

#include <atomic>
#include <memory>

#include "task_runtime/types.hpp"
#include "messaging/stream_transport.hpp"

namespace task_runtime {

class WorkerRuntime {
 public:
  WorkerRuntime(RuntimeConfig config, WorkerDefinition definition, std::shared_ptr<messaging::StreamTransport> transport);
  ~WorkerRuntime();
  WorkerRuntime(const WorkerRuntime&) = delete;
  WorkerRuntime& operator=(const WorkerRuntime&) = delete;

  void run();
  void request_stop();
  bool stopping() const { return stopping_.load(); }
  const std::atomic<bool>& stopping_flag() const { return stopping_; }

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
  std::atomic<bool> stopping_{false};
};

}  // namespace task_runtime

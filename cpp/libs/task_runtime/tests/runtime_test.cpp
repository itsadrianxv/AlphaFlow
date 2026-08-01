#include "task_runtime/runtime.hpp"

#include <gtest/gtest.h>
#include <condition_variable>
#include <mutex>
#include <stdexcept>

namespace task_runtime {
namespace {
class MemoryTransport final : public messaging::StreamTransport {
 public:
  std::unique_ptr<messaging::StreamTransport> clone() const override { return std::make_unique<MemoryTransport>(); }
  void ensure_group() override {}
  std::vector<StreamMessage> read(std::size_t) override { return {}; }
  std::vector<StreamMessage> auto_claim(std::size_t) override { return {}; }
  std::string publish(const StreamMessage&) override { return "1-0"; }
  void ack_delete(std::string_view) override {}
  bool ping() override { return true; }
};
}

TEST(WorkerRuntimeTest, RejectsIncompleteDefinition) {
  RuntimeConfig config;
  config.queue_capacity = 1;
  EXPECT_THROW(WorkerRuntime(config, {}, std::make_shared<MemoryTransport>()), std::invalid_argument);
}

TEST(WorkerRuntimeTest, StopIsIdempotent) {
  WorkerDefinition definition;
  definition.claim = [](const StreamMessage&) { return ClaimResult{}; };
  definition.execute = [](const RunTask&) { return ExecutionOutcome{}; };
  definition.commit = [](const RunTask&, const ExecutionOutcome&) {};
  WorkerRuntime runtime(RuntimeConfig{}, std::move(definition), std::make_shared<MemoryTransport>());
  runtime.request_stop();
  runtime.request_stop();
  EXPECT_TRUE(runtime.stopping());
}
}

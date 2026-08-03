#include "task_lifecycle/worker.hpp"

#include <gtest/gtest.h>

#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

namespace task_lifecycle {
namespace {

struct AuditLog {
  std::mutex mutex;
  std::vector<std::string> events;
  std::atomic<bool> recovery_ready{false};
};

struct TransportState {
  std::mutex mutex;
  std::deque<StreamMessage> fresh;
  std::deque<StreamMessage> pending;
  std::vector<std::string> acknowledged;
  std::shared_ptr<AuditLog> audit{std::make_shared<AuditLog>()};
};

class MemoryTransport final : public messaging::StreamTransport {
 public:
  explicit MemoryTransport(std::shared_ptr<TransportState> state) : state_(std::move(state)) {}
  std::unique_ptr<messaging::StreamTransport> clone() const override {
    return std::make_unique<MemoryTransport>(state_);
  }
  void ensure_group() override {}
  std::vector<StreamMessage> read(std::size_t count) override {
    std::lock_guard lock(state_->mutex);
    std::vector<StreamMessage> result;
    while (result.size() < count && !state_->fresh.empty()) {
      result.push_back(state_->fresh.front());
      state_->pending.push_back(state_->fresh.front());
      state_->fresh.pop_front();
    }
    return result;
  }
  std::vector<StreamMessage> auto_claim(std::size_t count) override {
    if (!state_->audit->recovery_ready.exchange(false)) return {};
    std::lock_guard lock(state_->mutex);
    std::vector<StreamMessage> result;
    for (const auto& message : state_->pending) {
      if (result.size() == count) break;
      result.push_back(message);
    }
    return result;
  }
  std::string publish(const StreamMessage&) override { return {}; }
  void ack_delete(std::string_view message_id) override {
    std::lock_guard lock(state_->mutex);
    {
      std::lock_guard audit_lock(state_->audit->mutex);
      state_->audit->events.push_back("ack");
    }
    state_->acknowledged.emplace_back(message_id);
    std::erase_if(state_->pending, [message_id](const auto& message) {
      return message.message_id == message_id;
    });
  }
  bool ping() override { return true; }

 private:
  std::shared_ptr<TransportState> state_;
};

struct RepositoryState {
  std::mutex mutex;
  std::condition_variable changed;
  ClaimDisposition claim_disposition{ClaimDisposition::claimed};
  int claims{};
  int attempts{};
  int settlements{};
  bool fail_settlement{};
  bool lose_lease{};
  std::vector<SettlementDisposition> dispositions;
  std::shared_ptr<AuditLog> audit;
};

class MemoryRepository {
 public:
  explicit MemoryRepository(std::shared_ptr<RepositoryState> state) : state_(std::move(state)) {}

  ClaimResult<std::string> claim(const StreamMessage& message) {
    std::lock_guard lock(state_->mutex);
    ++state_->claims;
    if (state_->claim_disposition == ClaimDisposition::defer) return ClaimResult<std::string>::defer();
    if (state_->claim_disposition == ClaimDisposition::discard) return ClaimResult<std::string>::discard();
    state_->claim_disposition = ClaimDisposition::defer;
    const int attempt = ++state_->attempts;
    return ClaimResult<std::string>::claimed({message, attempt, attempt, "input"});
  }

  std::vector<Lease> renew(const std::vector<Lease>& leases) {
    std::lock_guard lock(state_->mutex);
    return state_->lose_lease ? std::vector<Lease>{} : leases;
  }

  void settle(const Task<std::string>&, Settlement<int> settlement) {
    std::lock_guard lock(state_->mutex);
    {
      std::lock_guard audit_lock(state_->audit->mutex);
      state_->audit->events.push_back("settle");
    }
    if (state_->fail_settlement) throw std::runtime_error("数据库不可用");
    ++state_->settlements;
    state_->dispositions.push_back(settlement.disposition);
    if (settlement.disposition == SettlementDisposition::retry) {
      state_->claim_disposition = ClaimDisposition::claimed;
      state_->audit->recovery_ready.store(true);
    } else {
      state_->claim_disposition = ClaimDisposition::discard;
    }
    state_->changed.notify_all();
  }

 private:
  std::shared_ptr<RepositoryState> state_;
};

StreamMessage message() { return {"1-0", "event-1", "task-1", "now", "1"}; }

WorkerConfig config(const std::shared_ptr<TransportState>& state) {
  WorkerConfig value;
  value.transport = std::make_shared<MemoryTransport>(state);
  value.worker_threads = 1;
  value.queue_capacity = 1;
  value.heartbeat_interval = std::chrono::milliseconds(10);
  value.recovery_interval = std::chrono::milliseconds(10);
  value.retry_delays = {std::chrono::seconds(0)};
  return value;
}

bool wait_until(const std::function<bool()>& predicate) {
  for (int attempt = 0; attempt < 200; ++attempt) {
    if (predicate()) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  return false;
}

template <typename Executor>
void run_until(const std::shared_ptr<TransportState>& transport_state,
               const std::shared_ptr<RepositoryState>& repository_state,
               Executor executor, const std::function<bool()>& done) {
  {
    std::lock_guard lock(transport_state->mutex);
    transport_state->fresh.push_back(message());
  }
  repository_state->audit = transport_state->audit;
  auto worker = make_worker<std::string, int>(
      config(transport_state), MemoryRepository(repository_state), std::move(executor));
  std::thread thread([&] { worker->run(); });
  EXPECT_TRUE(wait_until(done));
  worker->request_stop();
  thread.join();
}

TEST(TaskLifecycleWorkerTest, ReducesCompletedTerminalAndObsoleteResults) {
  const std::vector<std::pair<ExecutionResult<int>, SettlementDisposition>> cases{
      {Completed<int>{7}, SettlementDisposition::completed},
      {TerminalFailure{{"INVALID", "invalid"}}, SettlementDisposition::terminal_failure},
      {Obsolete{}, SettlementDisposition::obsolete}};
  for (const auto& [outcome, expected] : cases) {
    auto transport = std::make_shared<TransportState>();
    auto repository = std::make_shared<RepositoryState>();
    run_until(transport, repository, [outcome](const auto&, std::stop_token) { return outcome; }, [&] {
      std::lock_guard lock(repository->mutex);
      return repository->settlements == 1;
    });
    EXPECT_EQ(repository->dispositions, std::vector{expected});
    EXPECT_EQ(transport->acknowledged, std::vector<std::string>{"1-0"});
  }
}

TEST(TaskLifecycleWorkerTest, KeepsRetryInPelAndExhaustsAttempts) {
  auto transport = std::make_shared<TransportState>();
  auto repository = std::make_shared<RepositoryState>();
  repository->audit = transport->audit;
  auto worker_config = config(transport);
  worker_config.max_attempts = 2;
  {
    std::lock_guard lock(transport->mutex);
    transport->fresh.push_back(message());
  }
  auto worker = make_worker<std::string, int>(
      worker_config, MemoryRepository(repository), [](const auto&, std::stop_token) -> ExecutionResult<int> {
        return RetryableFailure{{"TEMPORARY", "temporary"}};
      });
  std::thread thread([&] { worker->run(); });
  ASSERT_TRUE(wait_until([&] {
    std::lock_guard lock(repository->mutex);
    return repository->settlements == 2;
  }));
  worker->request_stop();
  thread.join();
  EXPECT_EQ(repository->dispositions,
            (std::vector{SettlementDisposition::retry,
                         SettlementDisposition::terminal_failure}));
  EXPECT_EQ(transport->acknowledged, std::vector<std::string>{"1-0"});
}

TEST(TaskLifecycleWorkerTest, DefersBusyMessageAndDiscardsTerminalMessage) {
  for (const auto disposition : {ClaimDisposition::defer, ClaimDisposition::discard}) {
    auto transport = std::make_shared<TransportState>();
    auto repository = std::make_shared<RepositoryState>();
    repository->claim_disposition = disposition;
    run_until(transport, repository, [](const auto&, std::stop_token) -> ExecutionResult<int> {
      return Completed<int>{1};
    }, [&] {
      std::lock_guard lock(repository->mutex);
      return repository->claims > 0;
    });
    EXPECT_TRUE(repository->dispositions.empty());
    EXPECT_EQ(transport->acknowledged.empty(), disposition == ClaimDisposition::defer);
  }
}

TEST(TaskLifecycleWorkerTest, PersistsBeforeAcknowledgingAndRetainsOnPersistenceFailure) {
  auto transport = std::make_shared<TransportState>();
  auto repository = std::make_shared<RepositoryState>();
  run_until(transport, repository, [](const auto&, std::stop_token) -> ExecutionResult<int> {
    return Completed<int>{1};
  }, [&] {
    std::lock_guard lock(repository->mutex);
    return repository->settlements == 1;
  });
  EXPECT_EQ(transport->audit->events, (std::vector<std::string>{"settle", "ack"}));

  transport = std::make_shared<TransportState>();
  repository = std::make_shared<RepositoryState>();
  repository->fail_settlement = true;
  run_until(transport, repository, [](const auto&, std::stop_token) -> ExecutionResult<int> {
    return Completed<int>{1};
  }, [&] {
    std::lock_guard lock(repository->mutex);
    return !repository->audit->events.empty();
  });
  EXPECT_EQ(repository->audit->events, std::vector<std::string>{"settle"});
  EXPECT_TRUE(transport->acknowledged.empty());
}

TEST(TaskLifecycleWorkerTest, RequestsTaskCancellationOnLeaseLossAndStop) {
  for (const bool lease_lost : {true, false}) {
    auto transport = std::make_shared<TransportState>();
    auto repository = std::make_shared<RepositoryState>();
    repository->lose_lease = lease_lost;
    std::atomic<bool> started{false};
    std::atomic<bool> cancelled{false};
    {
      std::lock_guard lock(transport->mutex);
      transport->fresh.push_back(message());
    }
    auto worker = make_worker<std::string, int>(
        config(transport), MemoryRepository(repository), [&](const auto&, std::stop_token token) -> ExecutionResult<int> {
          started.store(true);
          while (!token.stop_requested()) std::this_thread::yield();
          cancelled.store(true);
          return Obsolete{};
        });
    std::thread thread([&] { worker->run(); });
    ASSERT_TRUE(wait_until([&] { return started.load(); }));
    if (!lease_lost) worker->request_stop();
    ASSERT_TRUE(wait_until([&] { return cancelled.load(); }));
    worker->request_stop();
    thread.join();
    EXPECT_TRUE(repository->dispositions.empty());
    EXPECT_TRUE(transport->acknowledged.empty());
  }
}

TEST(TaskLifecycleWorkerTest, NeverExceedsConfiguredConcurrency) {
  struct Shared {
    std::mutex mutex;
    std::deque<StreamMessage> fresh;
    int settlements{};
    int active{};
    int max_active{};
    std::condition_variable changed;
  };

  class Transport final : public messaging::StreamTransport {
   public:
    explicit Transport(std::shared_ptr<Shared> state) : state_(std::move(state)) {}
    std::unique_ptr<messaging::StreamTransport> clone() const override {
      return std::make_unique<Transport>(state_);
    }
    void ensure_group() override {}
    std::vector<StreamMessage> read(std::size_t count) override {
      std::lock_guard lock(state_->mutex);
      std::vector<StreamMessage> result;
      while (result.size() < count && !state_->fresh.empty()) {
        result.push_back(state_->fresh.front());
        state_->fresh.pop_front();
      }
      return result;
    }
    std::vector<StreamMessage> auto_claim(std::size_t) override { return {}; }
    std::string publish(const StreamMessage&) override { return {}; }
    void ack_delete(std::string_view) override {}
    bool ping() override { return true; }

   private:
    std::shared_ptr<Shared> state_;
  };

  class Repository {
   public:
    explicit Repository(std::shared_ptr<Shared> state) : state_(std::move(state)) {}
    ClaimResult<std::string> claim(const StreamMessage& message) {
      return ClaimResult<std::string>::claimed({message, 1, 1, message.run_id});
    }
    std::vector<Lease> renew(const std::vector<Lease>& leases) { return leases; }
    void settle(const Task<std::string>&, Settlement<int>) {
      std::lock_guard lock(state_->mutex);
      ++state_->settlements;
      state_->changed.notify_all();
    }

   private:
    std::shared_ptr<Shared> state_;
  };

  auto state = std::make_shared<Shared>();
  for (int index = 0; index < 4; ++index) {
    state->fresh.push_back({std::to_string(index) + "-0", "", "task-" + std::to_string(index), "now", "1"});
  }
  WorkerConfig worker_config;
  worker_config.transport = std::make_shared<Transport>(state);
  worker_config.worker_threads = 2;
  worker_config.queue_capacity = 4;
  worker_config.heartbeat_interval = std::chrono::milliseconds(5);
  worker_config.recovery_interval = std::chrono::milliseconds(5);
  worker_config.retry_delays = {std::chrono::seconds(0)};

  auto worker = make_worker<std::string, int>(
      worker_config, Repository(state), [state](const Task<std::string>&, std::stop_token token) {
        if (token.stop_requested()) return ExecutionResult<int>{Obsolete{}};
        {
          std::lock_guard lock(state->mutex);
          ++state->active;
          state->max_active = std::max(state->max_active, state->active);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        {
          std::lock_guard lock(state->mutex);
          --state->active;
        }
        return ExecutionResult<int>{Completed<int>{1}};
      });
  std::thread thread([&] { worker->run(); });
  ASSERT_TRUE(wait_until([&] {
    std::lock_guard lock(state->mutex);
    return state->settlements == 4;
  }));
  worker->request_stop();
  thread.join();
  EXPECT_EQ(state->max_active, 2);
}

TEST(TaskLifecycleWorkerTest, AcquiresRenewsAndReleasesGlobalResourcePermit) {
  struct PermitState {
    std::mutex mutex;
    int acquired{};
    int renewed{};
    int released{};
    bool active{};
  };

  class PermitProvider final : public ResourcePermitProvider {
   public:
    explicit PermitProvider(std::shared_ptr<PermitState> state) : state_(std::move(state)) {}

    std::optional<ResourcePermitLease> acquire(const Lease& task,
                                               std::stop_token stop_token) override {
      if (stop_token.stop_requested()) return std::nullopt;
      std::lock_guard lock(state_->mutex);
      ++state_->acquired;
      state_->active = true;
      return ResourcePermitLease{task.task_id, "provider", task.task_id + ":permit",
                                 "worker", task.fencing_token};
    }

    std::vector<ResourcePermitLease> renew(
        const std::vector<ResourcePermitLease>& permits) override {
      std::lock_guard lock(state_->mutex);
      state_->renewed += static_cast<int>(permits.size());
      return permits;
    }

    void release(const ResourcePermitLease&, std::string_view) override {
      std::lock_guard lock(state_->mutex);
      ++state_->released;
      state_->active = false;
    }

   private:
    std::shared_ptr<PermitState> state_;
  };

  auto transport = std::make_shared<TransportState>();
  auto repository = std::make_shared<RepositoryState>();
  auto permit_state = std::make_shared<PermitState>();
  repository->audit = transport->audit;
  {
    std::lock_guard lock(transport->mutex);
    transport->fresh.push_back(message());
  }
  WorkerConfig worker_config = config(transport);
  worker_config.permit_provider = std::make_shared<PermitProvider>(permit_state);
  auto worker = make_worker<std::string, int>(
      worker_config, MemoryRepository(repository), [](const auto&, std::stop_token) {
        return ExecutionResult<int>{Completed<int>{1}};
      });
  std::thread thread([&] { worker->run(); });
  ASSERT_TRUE(wait_until([&] {
    std::lock_guard lock(repository->mutex);
    return repository->settlements == 1;
  }));
  worker->request_stop();
  thread.join();

  std::lock_guard lock(permit_state->mutex);
  EXPECT_EQ(permit_state->acquired, 1);
  EXPECT_EQ(permit_state->released, 1);
  EXPECT_FALSE(permit_state->active);
}

}  // namespace
}  // namespace task_lifecycle

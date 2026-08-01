#include "config.hpp"
#include "screening_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>
#include <string>

namespace {

std::string database_url() {
  const auto* value = std::getenv("SCREENING_REPOSITORY_TEST_DATABASE_URL");
  return value ? value : "";
}

Config config() {
  Config value;
  value.database_url = database_url();
  value.worker_id = "repository-contract-worker";
  value.lease_seconds = 30;
  return value;
}

class ScreeningRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) GTEST_SKIP() << "未设置 SCREENING_REPOSITORY_TEST_DATABASE_URL";
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec(R"SQL(TRUNCATE "ScreeningRunResult", "ScreeningRun" CASCADE)SQL");
    transaction.commit();
  }

  void insert_run(const std::string& id) {
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec_params(
        R"SQL(INSERT INTO "ScreeningRun" (id, config) VALUES ($1, '{}'::jsonb))SQL", id);
    transaction.commit();
  }
};

TEST_F(ScreeningRepositoryContractTest, ClaimIncrementsAttemptAndFencingAndDefersActiveLease) {
  insert_run("claim-contract");
  const auto repository_config = config();
  ScreeningRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "event", "claim-contract", "now", "1"};

  const auto first = repository.claim(message);
  ASSERT_EQ(first.disposition, task_lifecycle::ClaimDisposition::claimed);
  ASSERT_TRUE(first.task.has_value());
  EXPECT_EQ(first.task->attempt, 1);
  EXPECT_EQ(first.task->fencing_token, 1);
  EXPECT_EQ(repository.claim(message).disposition, task_lifecycle::ClaimDisposition::defer);

  pqxx::connection connection(database_url());
  pqxx::work transaction(connection);
  transaction.exec_params(
      R"SQL(UPDATE "ScreeningRun" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id=$1)SQL",
      message.run_id);
  transaction.commit();

  const auto takeover = repository.claim(message);
  ASSERT_TRUE(takeover.task.has_value());
  EXPECT_EQ(takeover.task->attempt, 2);
  EXPECT_EQ(takeover.task->fencing_token, 2);
}

TEST_F(ScreeningRepositoryContractTest, RenewAndSettleRejectOldFencingToken) {
  insert_run("fencing-contract");
  const auto repository_config = config();
  ScreeningRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "event", "fencing-contract", "now", "1"};
  auto first = repository.claim(message).task.value();

  pqxx::connection connection(database_url());
  pqxx::work transaction(connection);
  transaction.exec_params(
      R"SQL(UPDATE "ScreeningRun" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id=$1)SQL",
      message.run_id);
  transaction.commit();
  auto current = repository.claim(message).task.value();

  EXPECT_TRUE(repository.renew({{first.message.run_id, first.fencing_token}}).empty());
  EXPECT_EQ(repository.renew({{current.message.run_id, current.fencing_token}}).size(), 1);
  EXPECT_THROW(repository.settle(first, ScreeningSettlement::terminal({"STALE", "stale"})),
               task_lifecycle::LeaseLost);

  ScreeningExecutionResult result{message.run_id, "PARTIAL", 2, 1,
                                  {{"000001", 1}}, nlohmann::json::array({"partial"}),
                                  nlohmann::json::object()};
  repository.settle(current, ScreeningSettlement::completed(std::move(result)));

  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(SELECT status::text, attempts, "fencingToken", "totalCount" FROM "ScreeningRun" WHERE id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "PARTIAL");
  EXPECT_EQ(row[0][1].as<int>(), 2);
  EXPECT_EQ(row[0][2].as<std::int64_t>(), 2);
  EXPECT_EQ(row[0][3].as<int>(), 1);
}

TEST_F(ScreeningRepositoryContractTest, RetrySettlementHonorsDatabaseNextAttemptAt) {
  insert_run("retry-contract");
  const auto repository_config = config();
  ScreeningRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "event", "retry-contract", "now", "1"};
  auto task = repository.claim(message).task.value();
  repository.settle(task, ScreeningSettlement::retry({"TEMPORARY", "temporary"},
                                                     std::chrono::seconds(60)));
  EXPECT_EQ(repository.claim(message).disposition, task_lifecycle::ClaimDisposition::defer);
}

}  // namespace

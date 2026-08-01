#include "definitive_task_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>

namespace {
std::string database_url() {
  const auto* value = std::getenv("DEFINITIVE_TASK_REPOSITORY_TEST_DATABASE_URL");
  return value ? value : "";
}

Config config() {
  Config value;
  value.database_url = database_url();
  value.worker_id = "definitive-contract-worker";
  value.lease_seconds = 30;
  return value;
}

class DefinitiveTaskRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) GTEST_SKIP() << "未设置 DEFINITIVE_TASK_REPOSITORY_TEST_DATABASE_URL";
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec(R"SQL(TRUNCATE "ScheduledTaskScoreResult", "ScheduledTaskExecution", "ScheduledTaskVersion", "ScheduledTask" CASCADE)SQL");
    transaction.exec(R"SQL(INSERT INTO "ScheduledTask"(id) VALUES('task'); INSERT INTO "ScheduledTaskVersion"(id,"executionPlan") VALUES('version','{"type":"deterministic_scoring"}'::jsonb))SQL");
    transaction.commit();
  }

  void insert_execution(const std::string& id) {
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec_params(R"SQL(INSERT INTO "ScheduledTaskExecution"(id,"taskId","taskVersionId","scheduledAt") VALUES($1,'task','version',NOW()))SQL", id);
    transaction.commit();
  }
};

TEST_F(DefinitiveTaskRepositoryContractTest, RetryStaysRetryingUntilDatabaseDueTime) {
  insert_execution("retry-contract");
  const auto repository_config = config();
  DefinitiveTaskRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "retry-contract", "now", "1"};
  auto task = repository.claim(message).task.value();
  repository.settle(task, DefinitiveTaskSettlement::retry({"TEMP", "temporary"}, std::chrono::seconds(60)));
  EXPECT_EQ(repository.claim(message).disposition, task_lifecycle::ClaimDisposition::defer);
  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  EXPECT_EQ(read.exec_params(R"SQL(SELECT status::text FROM "ScheduledTaskExecution" WHERE id=$1)SQL", message.run_id)[0][0].as<std::string>(), "RETRYING");
}

TEST_F(DefinitiveTaskRepositoryContractTest, FencingRejectsOldOwnerAndTerminalSettlementIsAtomic) {
  insert_execution("fencing-contract");
  const auto repository_config = config();
  DefinitiveTaskRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "fencing-contract", "now", "1"};
  auto stale = repository.claim(message).task.value();
  pqxx::connection connection(database_url());
  pqxx::work expire(connection);
  expire.exec_params(R"SQL(UPDATE "ScheduledTaskExecution" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id=$1)SQL", message.run_id);
  expire.commit();
  auto current = repository.claim(message).task.value();
  EXPECT_TRUE(repository.renew({{message.run_id, stale.fencing_token}}).empty());
  EXPECT_THROW(repository.settle(stale, DefinitiveTaskSettlement::terminal({"STALE", "stale"})), task_lifecycle::LeaseLost);
  repository.settle(current, DefinitiveTaskSettlement::terminal({"INVALID", "invalid"}));
  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(R"SQL(SELECT status::text,error->>'code' FROM "ScheduledTaskExecution" WHERE id=$1)SQL", message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][1].as<std::string>(), "INVALID");
}
}

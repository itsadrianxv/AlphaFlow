#include "homepage_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>

namespace {
std::string database_url() {
  const auto* value = std::getenv("HOMEPAGE_REPOSITORY_TEST_DATABASE_URL");
  return value ? value : "";
}

Config config() {
  Config value;
  value.database_url = database_url();
  value.worker_id = "homepage-contract-worker";
  value.lease_seconds = 30;
  return value;
}

class HomePageRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) GTEST_SKIP() << "未设置 HOMEPAGE_REPOSITORY_TEST_DATABASE_URL";
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec(R"SQL(TRUNCATE "HomePageSnapshot", "HomePageGenerationTask" CASCADE)SQL");
    transaction.commit();
  }

  void insert_task(const std::string& id) {
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec_params(
        R"SQL(INSERT INTO "HomePageGenerationTask"(id,scope,"selectionJson") VALUES($1,'DEFAULT','{}'::jsonb))SQL",
        id);
    transaction.commit();
  }
};

TEST_F(HomePageRepositoryContractTest, ClaimRetryAndAtomicCompletedSettlement) {
  insert_task("homepage-contract");
  const auto repository_config = config();
  HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-contract", "now", "1"};
  auto first = repository.claim(message).task.value();
  EXPECT_EQ(first.attempt, 1);
  EXPECT_EQ(repository.claim(message).disposition, task_lifecycle::ClaimDisposition::defer);
  repository.settle(first, HomePageSettlement::retry({"TEMP", "temporary"}, std::chrono::seconds(60)));
  EXPECT_EQ(repository.claim(message).disposition, task_lifecycle::ClaimDisposition::defer);

  pqxx::connection connection(database_url());
  pqxx::work advance(connection);
  advance.exec_params(R"SQL(UPDATE "HomePageGenerationTask" SET "nextAttemptAt"=NOW() WHERE id=$1)SQL", message.run_id);
  advance.commit();
  auto current = repository.claim(message).task.value();
  repository.settle(current, HomePageSettlement::completed({nlohmann::json{{"market", "ok"}}, "2026-08-01"}));

  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(SELECT status::text,(SELECT COUNT(*) FROM "HomePageSnapshot" WHERE "generationTaskId"=$1) FROM "HomePageGenerationTask" WHERE id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "SUCCEEDED");
  EXPECT_EQ(row[0][1].as<int>(), 1);
}

TEST_F(HomePageRepositoryContractTest, ObsoleteMapsToCancelledAndOldFenceIsRejected) {
  insert_task("homepage-obsolete");
  const auto repository_config = config();
  HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-obsolete", "now", "1"};
  auto stale = repository.claim(message).task.value();
  pqxx::connection connection(database_url());
  pqxx::work expire(connection);
  expire.exec_params(R"SQL(UPDATE "HomePageGenerationTask" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id=$1)SQL", message.run_id);
  expire.commit();
  auto current = repository.claim(message).task.value();
  EXPECT_THROW(repository.settle(stale, HomePageSettlement::obsolete()), task_lifecycle::LeaseLost);
  repository.settle(current, HomePageSettlement::obsolete());
  pqxx::read_transaction read(connection);
  EXPECT_EQ(read.exec_params(R"SQL(SELECT status::text FROM "HomePageGenerationTask" WHERE id=$1)SQL", message.run_id)[0][0].as<std::string>(), "CANCELLED");
}
}

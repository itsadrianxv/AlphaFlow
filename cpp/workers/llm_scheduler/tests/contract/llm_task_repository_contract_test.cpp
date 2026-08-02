#include "llm_task_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>

namespace {

std::string database_url() {
  const auto* value = std::getenv("LLM_SCHEDULER_REPOSITORY_TEST_DATABASE_URL");
  return value ? value : "";
}

Config config() {
  Config value;
  value.database_url = database_url();
  value.worker_id = "llm-contract-worker";
  value.lease_seconds = 30;
  value.max_attempts = 3;
  return value;
}

task_lifecycle::StreamMessage message(const std::string& id) {
  return {"1-0", "", id, "now", "1", "EVENT_ADJUDICATION", id + ":v1", "sha256:" + id};
}

class LlmTaskRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) GTEST_SKIP() << "未设置 LLM_SCHEDULER_REPOSITORY_TEST_DATABASE_URL";
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec("TRUNCATE \"LlmTaskExecution\"");
    transaction.commit();
  }

  void insert_task(const std::string& id) {
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec_params(
        R"SQL(INSERT INTO "LlmTaskExecution"
               (id, "taskType", "idempotencyKey", "inputHash", "inputJson")
               VALUES($1,$2,$3,$4,'{"candidateClusterId":"cluster-1"}'::jsonb))SQL",
        id, "EVENT_ADJUDICATION", id + ":v1", "sha256:" + id);
    transaction.commit();
  }
};

TEST_F(LlmTaskRepositoryContractTest, RetryKeepsIdentityAndCompletedSettlementIsIdempotent) {
  insert_task("llm-contract");
  const auto repository_config = config();
  LlmTaskRepository repository(repository_config);
  const auto stream_message = message("llm-contract");
  auto first = repository.claim(stream_message).task.value();
  EXPECT_EQ(first.attempt, 1);
  repository.settle(first, LlmTaskSettlement::retry({"UPSTREAM_BUSY", "busy"}, std::chrono::seconds(60)));

  pqxx::connection connection(database_url());
  pqxx::work advance(connection);
  advance.exec_params(R"SQL(UPDATE "LlmTaskExecution" SET "nextAttemptAt"=NOW() WHERE id=$1)SQL",
                       stream_message.run_id);
  advance.commit();

  auto second = repository.claim(stream_message).task.value();
  EXPECT_EQ(second.attempt, 2);
  EXPECT_NE(second.fencing_token, first.fencing_token);
  EXPECT_THROW(repository.settle(first, LlmTaskSettlement::obsolete()), task_lifecycle::LeaseLost);
  repository.settle(second, LlmTaskSettlement::completed(
                               {"llm-contract", "EVENT_ADJUDICATION", "llm-contract:v1", "sha256:llm-contract",
                                nlohmann::json{{"decision", "HOLD"}}, nlohmann::json::object()}));

  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(SELECT status::text, result->'result'->>'decision' FROM "LlmTaskExecution" WHERE id=$1)SQL",
      stream_message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "SUCCEEDED");
  EXPECT_EQ(row[0][1].as<std::string>(), "HOLD");
  EXPECT_EQ(repository.claim(stream_message).disposition, task_lifecycle::ClaimDisposition::discard);
}

TEST_F(LlmTaskRepositoryContractTest, MismatchedMessageIdentityIsDiscarded) {
  insert_task("llm-mismatch");
  auto invalid = message("llm-mismatch");
  invalid.input_hash = "sha256:other";
  const auto result = LlmTaskRepository(config()).claim(invalid);
  EXPECT_EQ(result.disposition, task_lifecycle::ClaimDisposition::discard);
}

}  // namespace

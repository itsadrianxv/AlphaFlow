#include "homepage_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>
#include <future>
#include <string>

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

HomePageGenerationResult result_for(const std::string& marker) {
  return {nlohmann::json{{"marker", marker}}, "2026-08-01"};
}

class HomePageRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) {
      GTEST_SKIP() << "未设置 HOMEPAGE_REPOSITORY_TEST_DATABASE_URL";
    }
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    transaction.exec(
        R"SQL(TRUNCATE "HomepageCurrentSnapshotProjection","HomepageSnapshot","HomepageGenerationTask","HomepageDataManifest" CASCADE)SQL");
    transaction.commit();
  }

  void insert_task(const std::string& id,
                   std::int64_t activation_sequence = 1,
                   const std::string& promotion_mode = "PROMOTABLE") {
    pqxx::connection connection(database_url());
    pqxx::work transaction(connection);
    const auto manifest_id = "manifest-" + id;
    transaction.exec_params(
        R"SQL(
          INSERT INTO "HomepageDataManifest"(
            id,"manifestKey","canonicalizationVersion",scope,"definitionVersion",
            "targetContextKey","targetContextJson","activationSequence","gateStatus"
          )
          VALUES($1,$1,'homepage-manifest-key.v1','BASELINE','definition-v1',
                 'trade-date:20260801','{}'::jsonb,$2,'READY')
        )SQL",
        manifest_id, activation_sequence);
    transaction.exec_params(
        R"SQL(
          INSERT INTO "HomepageGenerationTask"(
            id,"generationKey","manifestId","activationSequence",
            "generationInputContractVersion","generatorDefinitionVersion",
            "payloadSchemaVersion","promotionMode","schedulingTier",
            "resourcePoolKey","fairnessKey","inputHash"
          )
          VALUES($1,$1,$2,$3,'homepage-generation-input.v1',
                 'homepage-generator.v1','homepage-payload.v1',$4,
                 'BACKGROUND','homepage-generation','baseline','sha256:input')
        )SQL",
        id, manifest_id, activation_sequence, promotion_mode);
    transaction.commit();
  }
};

TEST_F(HomePageRepositoryContractTest, ClaimRetryAndAtomicCompletedSettlement) {
  insert_task("homepage-contract");
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-contract", "now", "1"};

  auto first = repository.claim(message).task.value();
  EXPECT_EQ(first.attempt, 1);
  EXPECT_EQ(repository.claim(message).disposition,
            task_lifecycle::ClaimDisposition::defer);
  repository.settle(
      first,
      HomePageSettlement::retry({"TEMP", "temporary"}, std::chrono::seconds(60)));
  EXPECT_EQ(repository.claim(message).disposition,
            task_lifecycle::ClaimDisposition::defer);

  pqxx::connection connection(database_url());
  pqxx::work advance(connection);
  advance.exec_params(
      R"SQL(UPDATE "HomepageGenerationTask" SET "nextAttemptAt"=NOW() WHERE id=$1)SQL",
      message.run_id);
  advance.commit();
  auto current = repository.claim(message).task.value();
  repository.settle(current, HomePageSettlement::completed(result_for("done")));

  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(
        SELECT status,
               (SELECT COUNT(*) FROM "HomepageSnapshot" WHERE "generationTaskId"=$1),
               (SELECT COUNT(*) FROM "HomepageCurrentSnapshotProjection"
                WHERE scope='BASELINE')
        FROM "HomepageGenerationTask" WHERE id=$1
      )SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "SUCCEEDED");
  EXPECT_EQ(row[0][1].as<int>(), 1);
  EXPECT_EQ(row[0][2].as<int>(), 1);
}

TEST_F(HomePageRepositoryContractTest,
       RepeatingTheSameCompletedSettlementIsIdempotent) {
  insert_task("homepage-repeat");
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-repeat", "now",
                                               "1"};
  auto task = repository.claim(message).task.value();
  const auto result = HomePageSettlement::completed(result_for("same"));

  repository.settle(task, result);
  EXPECT_NO_THROW(repository.settle(task, result));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(
        SELECT status,
               (SELECT COUNT(*) FROM "HomepageSnapshot" WHERE "generationTaskId"=$1),
               (SELECT COUNT(*) FROM "HomepageCurrentSnapshotProjection"
                WHERE scope='BASELINE')
        FROM "HomepageGenerationTask" WHERE id=$1
      )SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "SUCCEEDED");
  EXPECT_EQ(row[0][1].as<int>(), 1);
  EXPECT_EQ(row[0][2].as<int>(), 1);
}

TEST_F(HomePageRepositoryContractTest,
       ConcurrentFirstPromotionKeepsTheHighestActivationSequence) {
  insert_task("homepage-old", 10);
  insert_task("homepage-new", 20);
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage old_message{"1-0", "", "homepage-old", "now",
                                                   "1"};
  const task_lifecycle::StreamMessage new_message{"2-0", "", "homepage-new", "now",
                                                   "1"};
  auto old_task = repository.claim(old_message).task.value();
  auto new_task = repository.claim(new_message).task.value();

  auto old_settlement = std::async(std::launch::async, [&] {
    repository.settle(old_task, HomePageSettlement::completed(result_for("old")));
  });
  auto new_settlement = std::async(std::launch::async, [&] {
    repository.settle(new_task, HomePageSettlement::completed(result_for("new")));
  });
  EXPECT_NO_THROW(old_settlement.get());
  EXPECT_NO_THROW(new_settlement.get());

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  const auto row = read.exec(
      R"SQL(
        SELECT projection."snapshotId", projection."activationSequence"
        FROM "HomepageCurrentSnapshotProjection" projection
        WHERE projection.scope='BASELINE'
      )SQL");
  ASSERT_EQ(row.size(), 1);
  EXPECT_EQ(row[0][0].as<std::string>(), "homepage-new");
  EXPECT_EQ(row[0][1].as<std::int64_t>(), 20);
}

TEST_F(HomePageRepositoryContractTest,
       HistoricalOnlyDoesNotPromoteAndOlderTaskCannotRollBackProjection) {
  insert_task("homepage-new", 10);
  insert_task("homepage-old", 5);
  insert_task("homepage-history", 12, "HISTORICAL_ONLY");
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);

  const task_lifecycle::StreamMessage newer{"1-0", "", "homepage-new", "now", "1"};
  auto new_task = repository.claim(newer).task.value();
  repository.settle(new_task,
                    HomePageSettlement::completed(result_for("new")));

  const task_lifecycle::StreamMessage older{"2-0", "", "homepage-old", "now", "1"};
  auto old_task = repository.claim(older).task.value();
  repository.settle(old_task,
                    HomePageSettlement::completed(result_for("old")));

  const task_lifecycle::StreamMessage history{"3-0", "", "homepage-history", "now",
                                              "1"};
  auto history_task = repository.claim(history).task.value();
  repository.settle(history_task,
                    HomePageSettlement::completed(result_for("history")));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  const auto row = read.exec(
      R"SQL(
        SELECT "snapshotId","activationSequence"
        FROM "HomepageCurrentSnapshotProjection"
        WHERE scope='BASELINE'
      )SQL");
  ASSERT_EQ(row.size(), 1);
  EXPECT_EQ(row[0][0].as<std::string>(), "homepage-new");
  EXPECT_EQ(row[0][1].as<std::int64_t>(), 10);
}

TEST_F(HomePageRepositoryContractTest, NonDeterministicConflictIsRejected) {
  insert_task("homepage-conflict");
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-conflict", "now",
                                               "1"};
  auto task = repository.claim(message).task.value();

  pqxx::connection connection(database_url());
  pqxx::work seed(connection);
  seed.exec_params(
      R"SQL(
        INSERT INTO "HomepageSnapshot"(
          id,"manifestId","generationTaskId",scope,"activationSequence",
          "generationInputContractVersion","generatorDefinitionVersion",
          "payloadSchemaVersion","inputHash","payloadHash",
          "dataCoverageJson","payloadJson"
        )
        VALUES($1,'manifest-homepage-conflict',$1,'BASELINE',1,
               'homepage-generation-input.v1','homepage-generator.v1',
               'homepage-payload.v1','sha256:input','sha256:existing',
               '{"legacyDataAsOf":"2026-08-01"}'::jsonb,
               '{"marker":"existing"}'::jsonb)
      )SQL",
      message.run_id);
  seed.commit();

  repository.settle(task,
                    HomePageSettlement::completed(result_for("different")));

  pqxx::read_transaction read(connection);
  const auto row = read.exec_params(
      R"SQL(SELECT status,"errorCode" FROM "HomepageGenerationTask" WHERE id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][1].as<std::string>(), "NON_DETERMINISTIC_GENERATION");
}

TEST_F(HomePageRepositoryContractTest, OldFenceIsRejected) {
  insert_task("homepage-obsolete");
  const auto repository_config = config();
  const HomePageRepository repository(repository_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "homepage-obsolete", "now",
                                               "1"};
  auto stale = repository.claim(message).task.value();

  pqxx::connection connection(database_url());
  pqxx::work expire(connection);
  expire.exec_params(
      R"SQL(UPDATE "HomepageGenerationTask"
             SET "leaseExpiresAt"=NOW()-INTERVAL '1 second'
             WHERE id=$1)SQL",
      message.run_id);
  expire.commit();
  auto current = repository.claim(message).task.value();

  EXPECT_THROW(repository.settle(stale, HomePageSettlement::obsolete()),
               task_lifecycle::LeaseLost);
  repository.settle(current, HomePageSettlement::obsolete());

  pqxx::read_transaction read(connection);
  EXPECT_EQ(read.exec_params(
                R"SQL(SELECT status FROM "HomepageGenerationTask" WHERE id=$1)SQL",
                message.run_id)[0][0]
                .as<std::string>(),
            "CANCELLED");
}
}  // namespace

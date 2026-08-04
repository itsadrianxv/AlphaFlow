#include "acquisition_repository.hpp"

#include <gtest/gtest.h>
#include <pqxx/pqxx>

#include <cstdlib>

namespace {
std::string database_url() {
  const auto* value = std::getenv("ACQUISITION_REPOSITORY_TEST_DATABASE_URL");
  return value ? value : "";
}

Config config() {
  Config value;
  value.database_url = database_url();
  value.worker_id = "acquisition-contract-worker";
  value.lease_seconds = 30;
  value.max_attempts = 3;
  return value;
}

class AcquisitionRepositoryContractTest : public ::testing::Test {
 protected:
  void SetUp() override {
    if (database_url().empty()) GTEST_SKIP() << "未设置 ACQUISITION_REPOSITORY_TEST_DATABASE_URL";
    pqxx::connection connection(database_url());
    pqxx::work tx(connection);
    tx.exec(R"SQL(
      TRUNCATE "HomepageDataManifestItemSettlementRevision",
               "HomepageDataManifestItemSettlement",
               "DataObservationRevisionSource",
               "DataObservationRevisionInput",
               "DataObservationRevision",
               "SourceAssertion",
               "DataObservation",
               "HomepageDataManifestItemAttempt",
               "HomepageDataManifestItem",
               "HomepageDataManifest" CASCADE
    )SQL");
    tx.commit();
  }

  void insert_attempt(const std::string& id, const std::string& manifest_id = "manifest-1",
                      const std::string& item_id = "item-1") {
    pqxx::connection connection(database_url());
    pqxx::work tx(connection);
    tx.exec_params(
        R"SQL(INSERT INTO "HomepageDataManifest" (
          id, "manifestKey", "canonicalizationVersion", scope, "definitionVersion", "targetContextKey", "targetContextJson"
        ) VALUES ($1, $2, 'jcs-1', 'BASELINE', 'definition-v1', 'ctx', '{}'::jsonb))SQL",
        manifest_id, "manifest-" + id);
    tx.exec_params(
        R"SQL(INSERT INTO "HomepageDataManifestItem" (
          id, "manifestId", "itemKey", "canonicalizationVersion", "datasetKey", "factScopeKey", "factScopeJson",
          "requirementVersion", required, "emptyPolicy", "targetDataCutoffKey", "targetDataCutoffJson"
        ) VALUES ($1, $2, $3, 'jcs-1', 'fixture', 'scope', '{"tradeDate":"2026-08-01"}'::jsonb,
          'requirements-v1', true, 'REQUIRE_NON_EMPTY', 'trade_date', '{"key":"trade_date","value":"2026-08-01"}'::jsonb))SQL",
        item_id, manifest_id, "item-" + id);
    tx.exec_params(
        R"SQL(INSERT INTO "HomepageDataManifestItemAttempt" (
          id, "manifestItemId", "attemptNo", "idempotencyKey", "providerKey", "providerContractVersion",
          "normalizationRulesVersion", "requestFingerprint"
        ) VALUES ($1, $2, 1, $3, 'test', '1.0', '1.0', 'sha256:request'))SQL",
        id, item_id, "idem-" + id);
    tx.commit();
  }

  ProviderFetchResult success_result() {
    return {nlohmann::json::parse(R"JSON({
      "contractVersion":"1.0",
      "datasetKey":"fixture",
      "providerKey":"test",
      "datasetPayloadVersion":"1.0",
      "normalizationRulesVersion":"1.0",
      "resultStatus":"success",
      "qualityStatus":"normal",
      "coverage":{"requestedScope":{"tradeDate":"2026-08-01"},"coveredScope":{"tradeDate":"2026-08-01"},"missingScope":{}},
      "actualDataCutoff":{"key":"trade_date","value":"2026-08-01"},
      "observations":[{
        "identityKey":"obs-1",
        "canonicalizationVersion":"jcs-1",
        "subjectType":"stock",
        "subjectKey":"600000.SH",
        "metricCatalogId":"close",
        "dimensions":{},
        "observationKind":"INSTANT",
        "observationPeriod":{"date":"2026-08-01"},
        "valueType":"decimal",
        "valueText":"10.50",
        "unit":"CNY",
        "qualityStatus":"normal"
      }],
      "sourceAssertions":[{
        "assertionKey":"assertion-1",
        "canonicalizationVersion":"jcs-1",
        "sourceKey":"test",
        "datasetKey":"fixture",
        "sourceRecordKey":"row-1",
        "observationIdentityKey":"obs-1",
        "rawRecord":{"close":"10.50"},
        "contentHash":"sha256:content",
        "requestParamsHash":"sha256:request",
        "providerVersion":"1.0",
        "fetchedAt":"2026-08-01T01:00:00Z"
      }],
      "authority":{"strategyVersion":"authority-1","selectedSourceKey":"test","selectionReason":"测试"},
      "normalizedAt":"2026-08-01T01:00:00Z",
      "resultHash":"sha256:result"
    })JSON"),
            "success",
            "sha256:result"};
  }
};

TEST_F(AcquisitionRepositoryContractTest, ClaimRenewAndSuccessfulSettlementAreIdempotent) {
  insert_attempt("attempt-1");
  AcquisitionRepository repository(config());
  const task_lifecycle::StreamMessage message{"1-0", "", "attempt-1", "now", "1"};
  auto claim = repository.claim(message);
  ASSERT_EQ(claim.disposition, task_lifecycle::ClaimDisposition::claimed);
  auto task = claim.task.value();
  EXPECT_EQ(task.attempt, 1);
  EXPECT_EQ(repository.renew({{task.message.run_id, task.fencing_token}}).size(), 1);

  repository.settle(task, AcquisitionSettlement::completed(success_result()));
  repository.settle(task, AcquisitionSettlement::completed(success_result()));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  auto row = read.exec_params(
      R"SQL(SELECT attempt.status, manifest."gateStatus",
                   (SELECT COUNT(*) FROM "HomepageDataManifestItemSettlement"),
                   (SELECT COUNT(*) FROM "DataObservationRevision"),
                   (SELECT COUNT(*) FROM "SourceAssertion"),
                   (SELECT COUNT(*) FROM "ResearchRuntimeObservation" WHERE stage='acquisition'),
                   (SELECT "observationContextJson"->>'taskId' FROM "ResearchRuntimeObservation" WHERE stage='acquisition' LIMIT 1)
            FROM "HomepageDataManifestItemAttempt" attempt
            JOIN "HomepageDataManifestItem" item ON item.id=attempt."manifestItemId"
            JOIN "HomepageDataManifest" manifest ON manifest.id=item."manifestId"
            WHERE attempt.id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "SUCCEEDED");
  EXPECT_EQ(row[0][1].as<std::string>(), "READY");
  EXPECT_EQ(row[0][2].as<int>(), 1);
  EXPECT_EQ(row[0][3].as<int>(), 1);
  EXPECT_EQ(row[0][4].as<int>(), 1);
  EXPECT_EQ(row[0][5].as<int>(), 1);
  EXPECT_EQ(row[0][6].as<std::string>(), message.run_id);
}

TEST_F(AcquisitionRepositoryContractTest, StaleFencingCannotWriteBusinessRowsAndTerminalFailureSettlesReason) {
  insert_attempt("attempt-stale");
  AcquisitionRepository repository(config());
  const task_lifecycle::StreamMessage message{"1-0", "", "attempt-stale", "now", "1"};
  auto stale = repository.claim(message).task.value();

  pqxx::connection connection(database_url());
  pqxx::work expire(connection);
  expire.exec_params(
      R"SQL(UPDATE "HomepageDataManifestItemAttempt" SET "leaseExpiresAt"=NOW()-INTERVAL '1 second' WHERE id=$1)SQL",
      message.run_id);
  expire.commit();

  auto current = repository.claim(message).task.value();
  EXPECT_THROW(repository.settle(stale, AcquisitionSettlement::completed(success_result())), task_lifecycle::LeaseLost);
  repository.settle(current, AcquisitionSettlement::terminal({"contract_incompatible", "版本不兼容"}));

  pqxx::read_transaction read(connection);
  auto row = read.exec_params(
      R"SQL(SELECT attempt.status, attempt."errorClass", settlement."settlementStatus", settlement."errorClass",
                   (SELECT COUNT(*) FROM "DataObservationRevision"),
                   (SELECT success FROM "ResearchRuntimeObservation" WHERE stage='acquisition' AND "observationContextJson"->>'taskId'=$1)
            FROM "HomepageDataManifestItemAttempt" attempt
            JOIN "HomepageDataManifestItemSettlement" settlement ON settlement."settledAttemptId"=attempt.id
            WHERE attempt.id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][1].as<std::string>(), "contract_incompatible");
  EXPECT_EQ(row[0][2].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][3].as<std::string>(), "contract_incompatible");
  EXPECT_EQ(row[0][4].as<int>(), 0);
  EXPECT_FALSE(row[0][5].as<bool>());
}

TEST_F(AcquisitionRepositoryContractTest, RetrySettlementWritesRuntimeObservation) {
  insert_attempt("attempt-retry");
  AcquisitionRepository repository(config());
  const task_lifecycle::StreamMessage message{"1-0", "", "attempt-retry", "now", "1"};
  auto task = repository.claim(message).task.value();

  repository.settle(task, AcquisitionSettlement::retry({"coverage_incomplete", "覆盖尚未完整"}, std::chrono::seconds(1)));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  auto row = read.exec_params(
      R"SQL(SELECT attempt.status, runtime."errorClass", runtime."observationContextJson"->>'degradedReason'
            FROM "HomepageDataManifestItemAttempt" attempt
            JOIN "ResearchRuntimeObservation" runtime
              ON runtime."observationContextJson"->>'taskId'=attempt.id
            WHERE attempt.id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "RETRY_WAIT");
  EXPECT_EQ(row[0][1].as<std::string>(), "coverage_incomplete");
  EXPECT_EQ(row[0][2].as<std::string>(), "coverage_incomplete");
}

TEST_F(AcquisitionRepositoryContractTest, RetryAtAttemptLimitCreatesTerminalSettlement) {
  insert_attempt("attempt-exhausted");
  auto exhausted_config = config();
  exhausted_config.max_attempts = 1;
  AcquisitionRepository repository(exhausted_config);
  const task_lifecycle::StreamMessage message{"1-0", "", "attempt-exhausted", "now", "1"};
  auto task = repository.claim(message).task.value();

  repository.settle(task, AcquisitionSettlement::retry({"upstream_unavailable", "上游不可用"}, std::chrono::seconds(1)));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  auto row = read.exec_params(
      R"SQL(SELECT attempt.status, settlement."settlementStatus", settlement."errorClass"
            FROM "HomepageDataManifestItemAttempt" attempt
            JOIN "HomepageDataManifestItemSettlement" settlement ON settlement."settledAttemptId"=attempt.id
            WHERE attempt.id=$1)SQL",
      message.run_id);
  EXPECT_EQ(row[0][0].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][1].as<std::string>(), "FAILED");
  EXPECT_EQ(row[0][2].as<std::string>(), "upstream_unavailable");
}

TEST_F(AcquisitionRepositoryContractTest, IdenticalObservationAcrossAttemptsReusesRevision) {
  AcquisitionRepository repository(config());
  insert_attempt("attempt-first");
  const task_lifecycle::StreamMessage first_message{"1-0", "", "attempt-first", "now", "1"};
  repository.settle(repository.claim(first_message).task.value(), AcquisitionSettlement::completed(success_result()));

  insert_attempt("attempt-second", "manifest-2", "item-2");
  const task_lifecycle::StreamMessage second_message{"2-0", "", "attempt-second", "now", "1"};
  repository.settle(repository.claim(second_message).task.value(), AcquisitionSettlement::completed(success_result()));

  pqxx::connection connection(database_url());
  pqxx::read_transaction read(connection);
  auto row = read.exec(
      R"SQL(SELECT COUNT(*), COUNT(*) FILTER (WHERE "supersedesRevisionId" = id)
            FROM "DataObservationRevision")SQL");
  EXPECT_EQ(row[0][0].as<int>(), 1);
  EXPECT_EQ(row[0][1].as<int>(), 0);
}
}  // namespace

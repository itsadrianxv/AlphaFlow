#include "homepage_repository.hpp"

#include <pqxx/pqxx>

#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>

namespace {
bool terminal(const std::string& status) {
  return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED";
}

std::string opaque_payload_hash(const nlohmann::json& payload) {
  constexpr std::uint64_t offset = 14695981039346656037ull;
  constexpr std::uint64_t prime = 1099511628211ull;
  std::uint64_t hash = offset;
  for (const auto byte : payload.dump()) {
    hash ^= static_cast<unsigned char>(byte);
    hash *= prime;
  }
  std::ostringstream value;
  value << "sha256:" << std::hex << std::setw(16) << std::setfill('0') << hash;
  return value.str();
}

template <typename Result>
std::string result_task_id(const Result& result, const std::string& fallback) {
  if constexpr (requires { result.task_id; }) {
    return result.task_id;
  }
  return fallback;
}

template <typename Result>
std::string result_manifest_id(const Result& result, const std::string& fallback) {
  if constexpr (requires { result.manifest_id; }) {
    return result.manifest_id;
  }
  return fallback;
}

template <typename Result>
std::int64_t result_activation_sequence(const Result& result,
                                        std::int64_t fallback) {
  if constexpr (requires { result.activation_sequence; }) {
    return result.activation_sequence;
  }
  return fallback;
}

template <typename Result>
std::string result_promotion_mode(const Result& result,
                                  const std::string& fallback) {
  if constexpr (requires { result.promotion_mode; }) {
    return result.promotion_mode;
  }
  return fallback;
}

template <typename Result>
std::string result_input_contract_version(const Result& result,
                                          const std::string& fallback) {
  if constexpr (requires { result.generation_input_contract_version; }) {
    return result.generation_input_contract_version;
  }
  return fallback;
}

template <typename Result>
std::string result_generator_definition_version(const Result& result,
                                                const std::string& fallback) {
  if constexpr (requires { result.generator_definition_version; }) {
    return result.generator_definition_version;
  }
  return fallback;
}

template <typename Result>
std::string result_payload_schema_version(const Result& result,
                                          const std::string& fallback) {
  if constexpr (requires { result.payload_schema_version; }) {
    return result.payload_schema_version;
  }
  return fallback;
}

template <typename Result>
std::string result_input_hash(const Result& result, const std::string& fallback) {
  if constexpr (requires { result.input_hash; }) {
    return result.input_hash;
  }
  return fallback;
}

template <typename Result>
std::string result_payload_hash(const Result& result) {
  if constexpr (requires { result.payload_hash; }) {
    return result.payload_hash;
  }
  return opaque_payload_hash(result.payload);
}

template <typename Result>
nlohmann::json result_data_coverage(const Result& result) {
  if constexpr (requires { result.data_coverage; }) {
    return result.data_coverage;
  }
  return nlohmann::json{{"legacyDataAsOf", result.data_as_of}};
}

bool snapshot_matches(pqxx::transaction_base& transaction,
                      const std::string& task_id,
                      const std::string& manifest_id,
                      std::int64_t activation_sequence,
                      const std::string& input_contract_version,
                      const std::string& generator_definition_version,
                      const std::string& payload_schema_version,
                      const std::string& input_hash,
                      const std::string& payload_hash,
                      const nlohmann::json& data_coverage,
                      const nlohmann::json& payload) {
  const auto existing = transaction.exec_params(
      R"SQL(
        SELECT 1
        FROM "HomepageSnapshot"
        WHERE "generationTaskId"=$1
          AND "manifestId"=$2
          AND "activationSequence"=$3
          AND "generationInputContractVersion"=$4
          AND "generatorDefinitionVersion"=$5
          AND "payloadSchemaVersion"=$6
          AND "inputHash"=$7
          AND "payloadHash"=$8
          AND "dataCoverageJson"=$9::jsonb
          AND "payloadJson"=$10::jsonb
      )SQL",
      task_id, manifest_id, activation_sequence, input_contract_version,
      generator_definition_version, payload_schema_version, input_hash,
      payload_hash, data_coverage.dump(), payload.dump());
  return !existing.empty();
}
}  // namespace

HomePageClaimResult HomePageRepository::claim(
    const task_lifecycle::StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(
        UPDATE "HomepageGenerationTask"
        SET status='RUNNING',
            attempts=attempts+1,
            "workerId"=$2,
            "fencingToken"="fencingToken"+1,
            "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),
            "heartbeatAt"=NOW(),
            "nextAttemptAt"=NULL,
            "startedAt"=COALESCE("startedAt",NOW()),
            "updatedAt"=NOW()
        WHERE id=$1
          AND (
            (
              status IN ('PENDING','RETRY_WAIT')
              AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=NOW())
            )
            OR (
              status='RUNNING'
              AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<=NOW())
            )
          )
        RETURNING "fencingToken",attempts
      )SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    HomePageTask task{message, rows[0][0].as<std::int64_t>(), rows[0][1].as<int>(),
                      nlohmann::json::object()};
    transaction.commit();
    return HomePageClaimResult::claimed(std::move(task));
  }
  const auto state = transaction.exec_params(
      R"SQL(SELECT status FROM "HomepageGenerationTask" WHERE id=$1)SQL",
      message.run_id);
  transaction.commit();
  if (state.empty() || terminal(state[0][0].as<std::string>())) {
    return HomePageClaimResult::discard();
  }
  return HomePageClaimResult::defer();
}

std::vector<task_lifecycle::Lease> HomePageRepository::renew(
    const std::vector<task_lifecycle::Lease>& leases) const {
  std::vector<task_lifecycle::Lease> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& lease : leases) {
    const auto result = transaction.exec_params(
        R"SQL(
          UPDATE "HomepageGenerationTask"
          SET "heartbeatAt"=NOW(),
              "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),
              "updatedAt"=NOW()
          WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
        )SQL",
        lease.task_id, lease.fencing_token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.push_back(lease);
  }
  transaction.commit();
  return renewed;
}

void HomePageRepository::settle(const HomePageTask& task,
                                HomePageSettlement settlement) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);

  if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(
          UPDATE "HomepageGenerationTask"
          SET status='RETRY_WAIT',
              "nextAttemptAt"=NOW()+($5*INTERVAL '1 second'),
              "errorCode"=$3,
              "errorDetailsJson"=jsonb_build_object('message',$4::text),
              "workerId"=NULL,
              "leaseExpiresAt"=NULL,
              "updatedAt"=NOW()
          WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
        )SQL",
        task.message.run_id, task.fencing_token, failure.code, failure.message,
        settlement.retry_delay.count());
    if (updated.affected_rows() != 1) {
      throw task_lifecycle::LeaseLost("写入重试状态时 lease 已失效");
    }
    transaction.commit();
    return;
  }

  if (settlement.disposition !=
      task_lifecycle::SettlementDisposition::completed) {
    const bool obsolete =
        settlement.disposition == task_lifecycle::SettlementDisposition::obsolete;
    const task_lifecycle::Failure failure = settlement.failure.value_or(
        task_lifecycle::Failure{"STALE_GENERATION_TASK", "任务已失去执行意义"});
    const auto updated = transaction.exec_params(
        R"SQL(
          UPDATE "HomepageGenerationTask"
          SET status=$3,
              "errorCode"=$4,
              "errorDetailsJson"=jsonb_build_object('message',$5::text),
              "workerId"=NULL,
              "leaseExpiresAt"=NULL,
              "completedAt"=NOW(),
              "updatedAt"=NOW()
          WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
        )SQL",
        task.message.run_id, task.fencing_token,
        obsolete ? "CANCELLED" : "FAILED", failure.code, failure.message);
    if (updated.affected_rows() != 1) {
      throw task_lifecycle::LeaseLost("写入终态时 lease 已失效");
    }
    transaction.commit();
    return;
  }

  const auto& result = *settlement.result;
  const auto locked = transaction.exec_params(
      R"SQL(
        SELECT id,status,"workerId",
               ("leaseExpiresAt" IS NULL OR "leaseExpiresAt">NOW()),
               "manifestId","activationSequence","promotionMode",
               "generationInputContractVersion","generatorDefinitionVersion",
               "payloadSchemaVersion","inputHash"
        FROM "HomepageGenerationTask"
        WHERE id=$1 AND "fencingToken"=$2
        FOR UPDATE
      )SQL",
      task.message.run_id, task.fencing_token);
  if (locked.empty()) {
    throw task_lifecycle::LeaseLost("提交快照前 lease 已失效");
  }

  const auto status = locked[0][1].as<std::string>();
  if (status != "RUNNING" && status != "SUCCEEDED") {
    throw task_lifecycle::LeaseLost("提交快照前任务已失效");
  }
  if (status == "RUNNING" &&
      (locked[0][2].is_null() ||
       locked[0][2].as<std::string>() != config_.worker_id ||
       !locked[0][3].as<bool>())) {
    throw task_lifecycle::LeaseLost("提交快照前 lease 已失效");
  }

  const auto manifest_id = locked[0][4].as<std::string>();
  const auto activation_sequence = locked[0][5].as<std::int64_t>();
  const auto promotion_mode = locked[0][6].as<std::string>();
  const auto input_contract_version = locked[0][7].as<std::string>();
  const auto generator_definition_version = locked[0][8].as<std::string>();
  const auto payload_schema_version = locked[0][9].as<std::string>();
  const auto input_hash = locked[0][10].as<std::string>("");
  const auto data_coverage = result_data_coverage(result);
  const auto payload_hash = result_payload_hash(result);
  const auto envelope_task_id =
      result_task_id(result, task.message.run_id);
  const auto envelope_manifest_id =
      result_manifest_id(result, manifest_id);
  const auto envelope_activation_sequence =
      result_activation_sequence(result, activation_sequence);
  const auto envelope_promotion_mode =
      result_promotion_mode(result, promotion_mode);
  const auto envelope_input_contract_version =
      result_input_contract_version(result, input_contract_version);
  const auto envelope_generator_definition_version =
      result_generator_definition_version(result, generator_definition_version);
  const auto envelope_payload_schema_version =
      result_payload_schema_version(result, payload_schema_version);
  const auto envelope_input_hash = result_input_hash(result, input_hash);

  if (envelope_task_id != task.message.run_id ||
      envelope_manifest_id != manifest_id ||
      envelope_activation_sequence != activation_sequence ||
      envelope_promotion_mode != promotion_mode ||
      envelope_input_contract_version != input_contract_version ||
      envelope_generator_definition_version != generator_definition_version ||
      envelope_payload_schema_version != payload_schema_version ||
      envelope_input_hash != input_hash) {
    if (status == "RUNNING") {
      transaction.exec_params(
          R"SQL(
            UPDATE "HomepageGenerationTask"
            SET status='FAILED',
                "errorCode"='INPUT_INVARIANT_VIOLATION',
                "errorDetailsJson"='{"reason":"result_identity_mismatch"}'::jsonb,
                "workerId"=NULL,
                "leaseExpiresAt"=NULL,
                "completedAt"=NOW(),
                "updatedAt"=NOW()
            WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
          )SQL",
          task.message.run_id, task.fencing_token);
      transaction.commit();
      return;
    }
    throw task_lifecycle::ExecutionError(
        "INPUT_INVARIANT_VIOLATION", "重复提交的结果身份不一致", false);
  }

  const auto inserted = transaction.exec_params(
      R"SQL(
        INSERT INTO "HomepageSnapshot"(
          id,"manifestId","generationTaskId",scope,"userId",
          "activationSequence","generationInputContractVersion",
          "generatorDefinitionVersion","payloadSchemaVersion",
          "inputHash","payloadHash","dataCoverageJson","payloadJson","generatedAt"
        )
        SELECT $1,"HomepageGenerationTask"."manifestId",
               "HomepageGenerationTask".id,manifest.scope,manifest."userId",
               "HomepageGenerationTask"."activationSequence",
               "generationInputContractVersion","generatorDefinitionVersion",
               "payloadSchemaVersion",$3,$4,$5::jsonb,$6::jsonb,NOW()
        FROM "HomepageGenerationTask"
        JOIN "HomepageDataManifest" manifest
          ON manifest.id="HomepageGenerationTask"."manifestId"
        WHERE "HomepageGenerationTask".id=$1
          AND "fencingToken"=$2
          AND status='RUNNING'
        ON CONFLICT("generationTaskId") DO NOTHING
      )SQL",
      task.message.run_id, task.fencing_token, envelope_input_hash, payload_hash,
      data_coverage.dump(), result.payload.dump());
  if (inserted.affected_rows() == 0 &&
      !snapshot_matches(
          transaction, task.message.run_id, envelope_manifest_id,
          envelope_activation_sequence, envelope_input_contract_version,
          envelope_generator_definition_version,
          envelope_payload_schema_version, envelope_input_hash, payload_hash,
          data_coverage, result.payload)) {
    if (status == "RUNNING") {
      transaction.exec_params(
          R"SQL(
            UPDATE "HomepageGenerationTask"
            SET status='FAILED',
                "errorCode"='NON_DETERMINISTIC_GENERATION',
                "errorDetailsJson"='{"reason":"snapshot_conflict"}'::jsonb,
                "workerId"=NULL,
                "leaseExpiresAt"=NULL,
                "completedAt"=NOW(),
                "updatedAt"=NOW()
            WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
          )SQL",
          task.message.run_id, task.fencing_token);
      transaction.commit();
      return;
    }
    throw task_lifecycle::ExecutionError(
        "NON_DETERMINISTIC_GENERATION", "重复提交的快照结果不一致", false);
  }

  if (envelope_promotion_mode == "PROMOTABLE") {
    transaction.exec_params(
        R"SQL(
          UPDATE "HomepageCurrentSnapshotProjection" projection
          SET "snapshotId"=snapshot.id,
              "activationSequence"=snapshot."activationSequence",
              "updatedAt"=NOW()
          FROM "HomepageSnapshot" snapshot
          WHERE snapshot."generationTaskId"=$1
            AND projection.scope=snapshot.scope
            AND (
              (projection."userId" IS NULL AND snapshot."userId" IS NULL)
              OR projection."userId"=snapshot."userId"
            )
            AND projection."activationSequence" < snapshot."activationSequence"
        )SQL",
        task.message.run_id);
    transaction.exec_params(
        R"SQL(
          INSERT INTO "HomepageCurrentSnapshotProjection"(
            id,scope,"userId","snapshotId","activationSequence","updatedAt"
          )
          SELECT $1||':current',snapshot.scope,snapshot."userId",snapshot.id,
                 snapshot."activationSequence",NOW()
          FROM "HomepageSnapshot" snapshot
          WHERE snapshot."generationTaskId"=$1
          ON CONFLICT DO NOTHING
        )SQL",
        task.message.run_id);
    transaction.exec_params(
        R"SQL(
          UPDATE "HomepageCurrentSnapshotProjection" projection
          SET "snapshotId"=snapshot.id,
              "activationSequence"=snapshot."activationSequence",
              "updatedAt"=NOW()
          FROM "HomepageSnapshot" snapshot
          WHERE snapshot."generationTaskId"=$1
            AND projection.scope=snapshot.scope
            AND (
              (projection."userId" IS NULL AND snapshot."userId" IS NULL)
              OR projection."userId"=snapshot."userId"
            )
            AND projection."activationSequence" < snapshot."activationSequence"
        )SQL",
        task.message.run_id);
  }

  if (status == "RUNNING") {
    const auto updated = transaction.exec_params(
        R"SQL(
          UPDATE "HomepageGenerationTask"
          SET status='SUCCEEDED',
              "errorCode"=NULL,
              "errorDetailsJson"=NULL,
              "workerId"=NULL,
              "leaseExpiresAt"=NULL,
              "nextAttemptAt"=NULL,
              "completedAt"=NOW(),
              "updatedAt"=NOW()
          WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING'
        )SQL",
        task.message.run_id, task.fencing_token);
    if (updated.affected_rows() != 1) {
      throw task_lifecycle::LeaseLost("提交终态时 lease 已失效");
    }
  }
  transaction.commit();
}

bool HomePageRepository::ping() const {
  try {
    pqxx::connection connection(config_.database_url);
    pqxx::read_transaction transaction(connection);
    return transaction.exec("SELECT 1")[0][0].as<int>() == 1;
  } catch (...) {
    return false;
  }
}

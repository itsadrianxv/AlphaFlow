#include "homepage_repository.hpp"

#include <pqxx/pqxx>

namespace {
bool terminal(const std::string& status) {
  return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED";
}
}

HomePageClaimResult HomePageRepository::claim(const task_lifecycle::StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(UPDATE "HomepageGenerationTask" SET status='RUNNING',attempts=attempts+1,"workerId"=$2,"fencingToken"="fencingToken"+1,"leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"heartbeatAt"=NOW(),"nextAttemptAt"=NULL,"startedAt"=COALESCE("startedAt",NOW()),"updatedAt"=NOW() WHERE id=$1 AND (((status='PENDING' OR status='RETRY_WAIT') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=NOW())) OR (status='RUNNING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<=NOW()))) RETURNING "fencingToken",attempts)SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    HomePageTask task{message, rows[0][0].as<std::int64_t>(), rows[0][1].as<int>(),
                      nlohmann::json::object()};
    transaction.commit();
    return HomePageClaimResult::claimed(std::move(task));
  }
  const auto state = transaction.exec_params(
      R"SQL(SELECT status FROM "HomepageGenerationTask" WHERE id=$1)SQL", message.run_id);
  transaction.commit();
  if (state.empty() || terminal(state[0][0].as<std::string>())) return HomePageClaimResult::discard();
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
        R"SQL(UPDATE "HomepageGenerationTask" SET "heartbeatAt"=NOW(),"leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        lease.task_id, lease.fencing_token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.push_back(lease);
  }
  transaction.commit();
  return renewed;
}

void HomePageRepository::settle(const HomePageTask& task, HomePageSettlement settlement) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  if (settlement.disposition == task_lifecycle::SettlementDisposition::completed) {
    const auto locked = transaction.exec_params(
        R"SQL(SELECT id,"manifestId","activationSequence","promotionMode","generationInputContractVersion","generatorDefinitionVersion","payloadSchemaVersion","inputHash" FROM "HomepageGenerationTask" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
        task.message.run_id, task.fencing_token);
    if (locked.empty()) throw task_lifecycle::LeaseLost("提交快照前 lease 已失效");
    const auto& result = *settlement.result;
    if (result.task_id != task.message.run_id ||
        result.manifest_id != locked[0][1].as<std::string>() ||
        result.activation_sequence != locked[0][2].as<std::int64_t>() ||
        result.promotion_mode != locked[0][3].as<std::string>() ||
        result.generation_input_contract_version != locked[0][4].as<std::string>() ||
        result.generator_definition_version != locked[0][5].as<std::string>() ||
        result.payload_schema_version != locked[0][6].as<std::string>() ||
        result.input_hash != locked[0][7].as<std::string>("")) {
      transaction.exec_params(
          R"SQL(UPDATE "HomepageGenerationTask" SET status='FAILED',"errorCode"='INPUT_INVARIANT_VIOLATION',"errorDetailsJson"='{"reason":"result_identity_mismatch"}'::jsonb,"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1)SQL",
          task.message.run_id);
      transaction.commit();
      return;
    }
    const auto inserted = transaction.exec_params(
        R"SQL(INSERT INTO "HomepageSnapshot"(id,"manifestId","generationTaskId",scope,"userId","activationSequence","generationInputContractVersion","generatorDefinitionVersion","payloadSchemaVersion","inputHash","payloadHash","dataCoverageJson","payloadJson","generatedAt")
              SELECT $1,"HomepageGenerationTask"."manifestId","HomepageGenerationTask".id,manifest.scope,manifest."userId","HomepageGenerationTask"."activationSequence","generationInputContractVersion","generatorDefinitionVersion","payloadSchemaVersion",$3::text,$4::text,$5::jsonb,$6::jsonb,NOW()
              FROM "HomepageGenerationTask" JOIN "HomepageDataManifest" manifest ON manifest.id="HomepageGenerationTask"."manifestId"
              WHERE "HomepageGenerationTask".id=$1 AND "fencingToken"=$2 AND status='RUNNING'
              ON CONFLICT("generationTaskId") DO NOTHING)SQL",
        task.message.run_id, task.fencing_token, result.input_hash, result.payload_hash,
        result.data_coverage.dump(), result.payload.dump());
    if (inserted.affected_rows() == 0) {
      const auto existing = transaction.exec_params(
          R"SQL(SELECT 1 FROM "HomepageSnapshot" WHERE "generationTaskId"=$1 AND "manifestId"=$2 AND "activationSequence"=$3 AND "generationInputContractVersion"=$4 AND "generatorDefinitionVersion"=$5 AND "payloadSchemaVersion"=$6 AND "inputHash"=$7 AND "payloadHash"=$8 AND "dataCoverageJson"=$9::jsonb AND "payloadJson"=$10::jsonb)SQL",
          task.message.run_id, result.manifest_id, result.activation_sequence,
          result.generation_input_contract_version, result.generator_definition_version,
          result.payload_schema_version, result.input_hash, result.payload_hash,
          result.data_coverage.dump(), result.payload.dump());
      if (existing.empty()) {
        transaction.exec_params(
            R"SQL(UPDATE "HomepageGenerationTask" SET status='FAILED',"errorCode"='NON_DETERMINISTIC_GENERATION',"errorDetailsJson"='{"reason":"snapshot_conflict"}'::jsonb,"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1)SQL",
            task.message.run_id);
        transaction.commit();
        return;
      }
    }
    if (result.promotion_mode == "PROMOTABLE") {
      transaction.exec_params(
          R"SQL(UPDATE "HomepageCurrentSnapshotProjection" projection
                SET "snapshotId"=snapshot.id,"activationSequence"=snapshot."activationSequence","updatedAt"=NOW()
                FROM "HomepageSnapshot" snapshot
                WHERE snapshot."generationTaskId"=$1
                  AND projection.scope=snapshot.scope
                  AND ((projection."userId" IS NULL AND snapshot."userId" IS NULL) OR projection."userId"=snapshot."userId")
                  AND projection."activationSequence" < snapshot."activationSequence")SQL",
          task.message.run_id);
      transaction.exec_params(
          R"SQL(INSERT INTO "HomepageCurrentSnapshotProjection"(id,scope,"userId","snapshotId","activationSequence","updatedAt")
                SELECT $1||':current',snapshot.scope,snapshot."userId",snapshot.id,snapshot."activationSequence",NOW()
                FROM "HomepageSnapshot" snapshot
                WHERE snapshot."generationTaskId"=$1
                  AND NOT EXISTS (
                    SELECT 1 FROM "HomepageCurrentSnapshotProjection" projection
                    WHERE projection.scope=snapshot.scope
                      AND ((projection."userId" IS NULL AND snapshot."userId" IS NULL) OR projection."userId"=snapshot."userId")
                  ))SQL",
          task.message.run_id);
    }
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomepageGenerationTask" SET status='SUCCEEDED',"errorCode"=NULL,"errorDetailsJson"=NULL,"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token);
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("提交终态时 lease 已失效");
  } else if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomepageGenerationTask" SET status='RETRY_WAIT',"nextAttemptAt"=NOW()+($5*INTERVAL '1 second'),"errorCode"=$3,"errorDetailsJson"=jsonb_build_object('message',$4),"workerId"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, failure.code, failure.message,
        settlement.retry_delay.count());
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入重试状态时 lease 已失效");
  } else {
    const bool obsolete = settlement.disposition == task_lifecycle::SettlementDisposition::obsolete;
    const task_lifecycle::Failure failure = settlement.failure.value_or(
        task_lifecycle::Failure{"STALE_GENERATION_TASK", "偏好指纹已过期"});
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomepageGenerationTask" SET status=$3,"errorCode"=$4,"errorDetailsJson"=jsonb_build_object('message',$5),"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, obsolete ? "CANCELLED" : "FAILED", failure.code,
        failure.message);
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入终态时 lease 已失效");
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

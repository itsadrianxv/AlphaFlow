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
      R"SQL(UPDATE "HomePageGenerationTask" SET status='RUNNING',attempts=attempts+1,"workerId"=$2,"fencingToken"="fencingToken"+1,"leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"heartbeatAt"=NOW(),"nextAttemptAt"=NULL,"startedAt"=COALESCE("startedAt",NOW()),"updatedAt"=NOW() WHERE id=$1 AND (((status='PENDING' OR status='RETRY_WAIT') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=NOW())) OR (status='RUNNING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<=NOW()))) RETURNING "selectionJson"::text,"fencingToken",attempts)SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    HomePageTask task{message, rows[0][1].as<std::int64_t>(), rows[0][2].as<int>(),
                      nlohmann::json::parse(rows[0][0].as<std::string>())};
    transaction.commit();
    return HomePageClaimResult::claimed(std::move(task));
  }
  const auto state = transaction.exec_params(
      R"SQL(SELECT status::text FROM "HomePageGenerationTask" WHERE id=$1)SQL", message.run_id);
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
        R"SQL(UPDATE "HomePageGenerationTask" SET "heartbeatAt"=NOW(),"leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
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
        R"SQL(SELECT id FROM "HomePageGenerationTask" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
        task.message.run_id, task.fencing_token);
    if (locked.empty()) throw task_lifecycle::LeaseLost("提交快照前 lease 已失效");
    const auto& result = *settlement.result;
    transaction.exec_params(
        R"SQL(INSERT INTO "HomePageSnapshot"(id,scope,"userId","preferenceFingerprint","baselineDefaultSnapshotId",payload,"dataAsOf","generatedAt","generationTaskId") SELECT id,scope,"userId","preferenceFingerprint","baselineDefaultSnapshotId",$3::jsonb,$4,NOW(),id FROM "HomePageGenerationTask" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' ON CONFLICT("generationTaskId") DO NOTHING)SQL",
        task.message.run_id, task.fencing_token, result.payload.dump(), result.data_as_of);
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomePageGenerationTask" SET status='SUCCEEDED',"errorCode"=NULL,"errorMessage"=NULL,"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token);
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("提交终态时 lease 已失效");
  } else if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomePageGenerationTask" SET status='RETRY_WAIT',"nextAttemptAt"=NOW()+($5*INTERVAL '1 second'),"errorCode"=$3,"errorMessage"=$4,"workerId"=NULL,"leaseExpiresAt"=NULL,"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, failure.code, failure.message,
        settlement.retry_delay.count());
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入重试状态时 lease 已失效");
  } else {
    const bool obsolete = settlement.disposition == task_lifecycle::SettlementDisposition::obsolete;
    const task_lifecycle::Failure failure = settlement.failure.value_or(
        task_lifecycle::Failure{"STALE_GENERATION_TASK", "偏好指纹已过期"});
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomePageGenerationTask" SET status=$3::"HomePageGenerationTaskStatus","errorCode"=$4,"errorMessage"=$5,"workerId"=NULL,"leaseExpiresAt"=NULL,"completedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
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

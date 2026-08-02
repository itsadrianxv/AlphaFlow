#include "llm_task_repository.hpp"

#include <pqxx/pqxx>

#include <string>

namespace {

bool terminal_status(const std::string& status) {
  return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED";
}

nlohmann::json failure_json(const task_lifecycle::Failure& failure, bool retryable) {
  return nlohmann::json{{"code", failure.code}, {"message", failure.message}, {"retryable", retryable}};
}

}  // namespace

LlmTaskClaimResult LlmTaskRepository::claim(const task_lifecycle::StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(
        UPDATE "LlmTaskExecution" AS task
        SET status='RUNNING', attempts=task.attempts+1, "workerId"=$5,
            "fencingToken"=task."fencingToken"+1,
            "leaseExpiresAt"=NOW()+($6 * INTERVAL '1 second'),
            "heartbeatAt"=NOW(), "nextAttemptAt"=NULL,
            "startedAt"=COALESCE(task."startedAt", NOW()), "updatedAt"=NOW()
        WHERE task.id=$1
          AND task."taskType"=$2
          AND task."idempotencyKey"=$3
          AND task."inputHash"=$4
          AND task.attempts < $7
          AND ((task.status IN ('PENDING','RETRY_WAIT') AND
                (task."nextAttemptAt" IS NULL OR task."nextAttemptAt" <= NOW()))
            OR (task.status='RUNNING' AND
                (task."leaseExpiresAt" IS NULL OR task."leaseExpiresAt" <= NOW())))
        RETURNING task."taskType", task."idempotencyKey", task."inputHash",
                  task."inputJson"::text, task."fencingToken", task.attempts
      )SQL",
      message.run_id, message.task_type, message.idempotency_key, message.input_hash, config_.worker_id,
      config_.lease_seconds, config_.max_attempts);

  if (!rows.empty()) {
    LlmTaskInput input;
    input.task_type = rows[0][0].as<std::string>();
    input.idempotency_key = rows[0][1].as<std::string>();
    input.input_hash = rows[0][2].as<std::string>();
    input.payload = nlohmann::json::parse(rows[0][3].as<std::string>());
    LlmTask task{message, rows[0][4].as<std::int64_t>(), rows[0][5].as<int>(), std::move(input)};
    transaction.commit();
    return LlmTaskClaimResult::claimed(std::move(task));
  }

  const auto state = transaction.exec_params(
      R"SQL(SELECT status::text, "taskType", "idempotencyKey", "inputHash", attempts
             FROM "LlmTaskExecution" WHERE id=$1)SQL",
      message.run_id);
  transaction.commit();
  if (state.empty() || terminal_status(state[0][0].as<std::string>())) return LlmTaskClaimResult::discard();
  if (state[0][4].as<int>() >= config_.max_attempts) return LlmTaskClaimResult::discard();
  if (state[0][1].as<std::string>() != message.task_type ||
      state[0][2].as<std::string>() != message.idempotency_key ||
      state[0][3].as<std::string>() != message.input_hash) {
    return LlmTaskClaimResult::discard();
  }
  return LlmTaskClaimResult::defer();
}

std::vector<task_lifecycle::Lease> LlmTaskRepository::renew(
    const std::vector<task_lifecycle::Lease>& leases) const {
  std::vector<task_lifecycle::Lease> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& lease : leases) {
    const auto result = transaction.exec_params(
        R"SQL(UPDATE "LlmTaskExecution"
               SET "heartbeatAt"=NOW(), "leaseExpiresAt"=NOW()+($3 * INTERVAL '1 second'), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        lease.task_id, lease.fencing_token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.push_back(lease);
  }
  transaction.commit();
  return renewed;
}

void LlmTaskRepository::settle(const LlmTask& task, LlmTaskSettlement settlement) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);

  if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "LlmTaskExecution"
        SET status='RETRY_WAIT', "nextAttemptAt"=NOW()+($4 * INTERVAL '1 second'),
                   error=$3::jsonb, "workerId"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, failure_json(failure, true).dump(), settlement.retry_delay.count());
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入 LLM 重试状态时 lease 已失效");
    transaction.commit();
    return;
  }

  if (settlement.disposition != task_lifecycle::SettlementDisposition::completed) {
    const bool obsolete = settlement.disposition == task_lifecycle::SettlementDisposition::obsolete;
    const auto failure = settlement.failure.value_or(
        task_lifecycle::Failure{"LLM_TASK_OBSOLETE", "LLM 任务已经失去执行意义"});
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "LlmTaskExecution"
               SET status=$3::"LlmTaskExecutionStatus", error=$4::jsonb,
                   "workerId"=NULL, "leaseExpiresAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, obsolete ? "CANCELLED" : "FAILED",
        failure_json(failure, false).dump());
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入 LLM 终态时 lease 已失效");
    transaction.commit();
    return;
  }

  const auto& result = *settlement.result;
  const auto locked = transaction.exec_params(
      R"SQL(SELECT id FROM "LlmTaskExecution"
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
      task.message.run_id, task.fencing_token);
  if (locked.empty()) throw task_lifecycle::LeaseLost("提交 LLM 结果前 lease 已失效");

  const nlohmann::json result_json{{"schemaVersion", 1},
                                   {"taskId", result.task_id},
                                   {"taskType", result.task_type},
                                   {"idempotencyKey", result.idempotency_key},
                                   {"inputHash", result.input_hash},
                                   {"result", result.result},
                                   {"metadata", result.metadata}};
  const auto updated = transaction.exec_params(
      R"SQL(UPDATE "LlmTaskExecution"
             SET status='SUCCEEDED', result=$3::jsonb, error=NULL,
                 "workerId"=NULL, "leaseExpiresAt"=NULL, "nextAttemptAt"=NULL,
                 "completedAt"=NOW(), "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, result_json.dump());
  if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("提交 LLM 终态时 lease 已失效");
  transaction.commit();
}

bool LlmTaskRepository::ping() const {
  try {
    pqxx::connection connection(config_.database_url);
    pqxx::read_transaction transaction(connection);
    return transaction.exec("SELECT 1")[0][0].as<int>() == 1;
  } catch (...) {
    return false;
  }
}

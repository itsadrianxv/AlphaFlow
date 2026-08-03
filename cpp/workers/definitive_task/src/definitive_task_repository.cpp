#include "definitive_task_repository.hpp"

#include <pqxx/pqxx>

#include <stdexcept>
#include <tuple>
#include <vector>

namespace {
bool terminal_status(const std::string& status) {
  return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED";
}
}  // namespace

DefinitiveTaskClaimResult DefinitiveTaskRepository::claim(const task_lifecycle::StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(
        UPDATE "ScheduledTaskExecution" AS execution
        SET status = 'RUNNING', "attempts" = execution."attempts" + 1, "workerId" = $2,
            "fencingToken" = execution."fencingToken" + 1,
            "leaseExpiresAt" = NOW() + ($3 * INTERVAL '1 second'),
            "heartbeatAt" = NOW(), "nextAttemptAt" = NULL,
            "startedAt" = COALESCE(execution."startedAt", NOW()), "updatedAt" = NOW()
        FROM "ScheduledTaskVersion" AS version, "ScheduledTask" AS task
        WHERE execution.id = $1
          AND version.id = execution."taskVersionId"
          AND task.id = execution."taskId"
          AND version."executionPlan"->>'type' = 'deterministic_scoring'
          AND execution.attempts < 4 AND (
          (execution.status IN ('PENDING', 'SUBMITTED') OR
           (execution.status = 'RETRYING' AND execution."nextAttemptAt" <= NOW()))
          OR (execution.status = 'RUNNING' AND
              (execution."leaseExpiresAt" IS NULL OR execution."leaseExpiresAt" <= NOW()))
        )
        RETURNING jsonb_build_object(
          'schemaVersion', 1,
          'executionId', execution.id,
          'taskVersionId', execution."taskVersionId",
          'scheduledAt', to_char(execution."scheduledAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'timezone', task.timezone,
          'executionPlan', COALESCE(execution."executionPlanOverride", version."executionPlan")
        )::text, execution."fencingToken", execution.attempts
      )SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    DefinitiveTask task{message, rows[0][1].as<std::int64_t>(), rows[0][2].as<int>(),
                        nlohmann::json::parse(rows[0][0].as<std::string>())};
    transaction.commit();
    return DefinitiveTaskClaimResult::claimed(std::move(task));
  }
  const auto state = transaction.exec_params(R"SQL(SELECT status::text FROM "ScheduledTaskExecution" WHERE id = $1)SQL", message.run_id);
  transaction.commit();
  if (state.empty() || terminal_status(state[0][0].as<std::string>())) return DefinitiveTaskClaimResult::discard();
  return DefinitiveTaskClaimResult::defer();
}

std::vector<task_lifecycle::Lease> DefinitiveTaskRepository::renew(
    const std::vector<task_lifecycle::Lease>& leases) const {
  std::vector<task_lifecycle::Lease> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& lease : leases) {
    const auto result = transaction.exec_params(
        R"SQL(UPDATE "ScheduledTaskExecution" SET "heartbeatAt"=NOW(), "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        lease.task_id, lease.fencing_token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.push_back(lease);
  }
  transaction.commit();
  return renewed;
}

void DefinitiveTaskRepository::settle(const DefinitiveTask& task, DefinitiveTaskSettlement settlement) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "ScheduledTaskExecution" SET status='RETRYING', "nextAttemptAt"=NOW()+($5*INTERVAL '1 second'), error=jsonb_build_object('code',$3::text,'message',$4::text,'retryable',true), "workerId"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, failure.code, failure.message,
        settlement.retry_delay.count());
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入重试状态时 lease 已失效");
    transaction.commit();
    return;
  }
  if (settlement.disposition != task_lifecycle::SettlementDisposition::completed) {
    const auto failure = settlement.failure.value_or(task_lifecycle::Failure{"TASK_OBSOLETE", "任务已过期"});
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "ScheduledTaskExecution" SET status=$3::"ScheduledTaskExecutionStatus", error=jsonb_build_object('code',$4::text,'message',$5::text,'retryable',false), "workerId"=NULL, "leaseExpiresAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW() WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token,
        settlement.disposition == task_lifecycle::SettlementDisposition::obsolete ? "CANCELLED" : "FAILED",
        failure.code, failure.message);
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入终态时 lease 已失效");
    transaction.commit();
    return;
  }
  const auto& result = *settlement.result;
  const auto locked = transaction.exec_params(
      R"SQL(SELECT id FROM "ScheduledTaskExecution" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
      task.message.run_id, task.fencing_token);
  if (locked.empty()) throw task_lifecycle::LeaseLost("提交结果前 lease 已失效");

  transaction.exec(R"SQL(CREATE TEMP TABLE definitive_result_stage (
    stock_code TEXT NOT NULL, stock_name TEXT NOT NULL, rank INTEGER NOT NULL,
    selected BOOLEAN NOT NULL, evaluation_status TEXT NOT NULL,
    score DOUBLE PRECISION NOT NULL, max_score DOUBLE PRECISION NOT NULL,
    rule_results JSONB NOT NULL
  ) ON COMMIT DROP)SQL");
  {
    const std::vector<std::string> columns{
        "stock_code", "stock_name", "rank", "selected", "evaluation_status", "score", "max_score", "rule_results"};
    pqxx::stream_to stream(transaction, "definitive_result_stage", columns);
    for (const auto& row : result.results)
      stream << std::make_tuple(row.stock_code, row.stock_name, row.rank, row.selected,
                                row.evaluation_status, row.score, row.max_score, row.rule_results.dump());
    stream.complete();
  }
  const auto validation = transaction.exec(
      R"SQL(SELECT COUNT(*) AS total, COUNT(DISTINCT stock_code) AS stocks, COUNT(DISTINCT rank) AS ranks,
                    COALESCE(MIN(rank), 0) AS min_rank, COALESCE(MAX(rank), 0) AS max_rank
             FROM definitive_result_stage)SQL");
  const int count = validation[0][0].as<int>();
  if (count != result.universe_count || validation[0][1].as<int>() != count || validation[0][2].as<int>() != count ||
      (count > 0 && (validation[0][3].as<int>() != 1 || validation[0][4].as<int>() != count))) {
    throw WorkerError("INVALID_RESULT_STAGE", "临时结果表校验失败", false);
  }

  transaction.exec_params(R"SQL(DELETE FROM "ScheduledTaskScoreResult" WHERE "executionId"=$1)SQL", task.message.run_id);
  transaction.exec_params(
      R"SQL(INSERT INTO "ScheduledTaskScoreResult"
             (id, "executionId", "stockCode", "stockName", rank, selected, "evaluationStatus", score, "maxScore", "ruleResults")
             SELECT $1 || ':' || stock_code, $1, stock_code, stock_name, rank, selected,
                    evaluation_status, score, max_score, rule_results
             FROM definitive_result_stage ORDER BY rank)SQL",
      task.message.run_id);
  const nlohmann::json summary = {
      {"type", "SCORING_REPORT"}, {"schemaVersion", 1}, {"asOfDate", result.as_of_date},
      {"universeCount", result.universe_count}, {"evaluatedCount", result.evaluated_count},
      {"selectedCount", result.selected_count}, {"rules", result.rules},
      {"warnings", result.warnings}, {"diagnostics", result.diagnostics}};
  const auto updated = transaction.exec_params(
      R"SQL(UPDATE "ScheduledTaskExecution" SET status='SUCCEEDED', result=$3::jsonb, error=NULL,
             "workerId"=NULL, "leaseExpiresAt"=NULL, "nextAttemptAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, summary.dump());
  if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("提交终态时 lease 已失效");
  transaction.commit();
}

bool DefinitiveTaskRepository::ping() const {
  try {
    pqxx::connection connection(config_.database_url);
    pqxx::read_transaction transaction(connection);
    return transaction.exec("SELECT 1")[0][0].as<int>() == 1;
  } catch (...) {
    return false;
  }
}


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

ClaimResult DefinitiveTaskRepository::claim(const StreamMessage& message) const {
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
          'executionPlan', version."executionPlan"
        )::text, execution."fencingToken", execution.attempts
      )SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    RunTask task{message, rows[0][1].as<std::int64_t>(), rows[0][2].as<int>(),
                 nlohmann::json::parse(rows[0][0].as<std::string>())};
    transaction.commit();
    return {ClaimStatus::claimed, std::move(task)};
  }
  const auto state = transaction.exec_params(R"SQL(SELECT status::text FROM "ScheduledTaskExecution" WHERE id = $1)SQL", message.run_id);
  transaction.commit();
  if (state.empty()) return {ClaimStatus::missing, {}};
  return {terminal_status(state[0][0].as<std::string>()) ? ClaimStatus::terminal : ClaimStatus::busy, {}};
}

std::vector<std::pair<std::string, std::int64_t>> DefinitiveTaskRepository::heartbeat(
    const std::vector<std::pair<std::string, std::int64_t>>& leases) const {
  std::vector<std::pair<std::string, std::int64_t>> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& [run_id, token] : leases) {
    const auto result = transaction.exec_params(
        R"SQL(UPDATE "ScheduledTaskExecution" SET "heartbeatAt"=NOW(), "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        run_id, token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.emplace_back(run_id, token);
  }
  transaction.commit();
  return renewed;
}

bool DefinitiveTaskRepository::schedule_retry(const RunTask& task, const WorkerError& error, int delay_seconds) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto result = transaction.exec_params(
      R"SQL(UPDATE "ScheduledTaskExecution" SET status='RETRYING', "nextAttemptAt"=NOW()+($5*INTERVAL '1 second'),
             error=jsonb_build_object('code',$3::text,'message',$4::text,'retryable',true), "workerId"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, error.code(), error.what(), delay_seconds);
  transaction.commit();
  return result.affected_rows() == 1;
}

bool DefinitiveTaskRepository::mark_submitted(const std::string& execution_id) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto result = transaction.exec_params(
      R"SQL(UPDATE "ScheduledTaskExecution" SET status='SUBMITTED', "updatedAt"=NOW()
             WHERE id=$1 AND status='RETRYING')SQL",
      execution_id);
  transaction.commit();
  return result.affected_rows() == 1;
}

bool DefinitiveTaskRepository::mark_failed(const RunTask& task, const WorkerError& error) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto result = transaction.exec_params(
      R"SQL(UPDATE "ScheduledTaskExecution" SET status='FAILED', error=jsonb_build_object('code',$3::text,'message',$4::text,'retryable',false),
             "workerId"=NULL, "leaseExpiresAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, error.code(), error.what());
  transaction.commit();
  return result.affected_rows() == 1;
}

void DefinitiveTaskRepository::commit_result(const RunTask& task, const DefinitiveTaskExecutionResult& result) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto locked = transaction.exec_params(
      R"SQL(SELECT id FROM "ScheduledTaskExecution" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
      task.message.run_id, task.fencing_token);
  if (locked.empty()) throw WorkerError("LEASE_LOST", "提交结果前 lease 已失效", true);

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
  if (updated.affected_rows() != 1) throw WorkerError("LEASE_LOST", "提交终态时 lease 已失效", true);
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


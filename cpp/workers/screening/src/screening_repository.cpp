#include "screening_repository.hpp"

#include <pqxx/pqxx>

#include <stdexcept>
#include <tuple>
#include <vector>

namespace {
bool terminal_status(const std::string& status) {
  return status == "SUCCEEDED" || status == "PARTIAL" || status == "FAILED";
}
}  // namespace

ClaimResult ScreeningRepository::claim(const StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(
        UPDATE "ScreeningRun"
        SET status = 'RUNNING', "attempts" = "attempts" + 1, "workerId" = $2,
            "fencingToken" = "fencingToken" + 1,
            "leaseExpiresAt" = NOW() + ($3 * INTERVAL '1 second'),
            "heartbeatAt" = NOW(), "nextAttemptAt" = NULL,
            "startedAt" = COALESCE("startedAt", NOW()), "updatedAt" = NOW()
        WHERE id = $1 AND (
          (status IN ('PENDING', 'RETRYING') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW()))
          OR (status = 'RUNNING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= NOW()))
        )
        RETURNING "config"::text, "fencingToken", "attempts"
      )SQL",
      message.run_id, config_.worker_id, config_.lease_seconds);
  if (!rows.empty()) {
    RunTask task{message, rows[0][1].as<std::int64_t>(), rows[0][2].as<int>(),
                 nlohmann::json::parse(rows[0][0].as<std::string>())};
    transaction.commit();
    return {ClaimStatus::claimed, std::move(task)};
  }
  const auto state = transaction.exec_params(R"SQL(SELECT status::text FROM "ScreeningRun" WHERE id = $1)SQL", message.run_id);
  transaction.commit();
  if (state.empty()) return {ClaimStatus::missing, {}};
  return {terminal_status(state[0][0].as<std::string>()) ? ClaimStatus::terminal : ClaimStatus::busy, {}};
}

std::vector<std::pair<std::string, std::int64_t>> ScreeningRepository::heartbeat(
    const std::vector<std::pair<std::string, std::int64_t>>& leases) const {
  std::vector<std::pair<std::string, std::int64_t>> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& [run_id, token] : leases) {
    const auto result = transaction.exec_params(
        R"SQL(UPDATE "ScreeningRun" SET "heartbeatAt"=NOW(), "leaseExpiresAt"=NOW()+($3*INTERVAL '1 second'), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
        run_id, token, config_.lease_seconds);
    if (result.affected_rows() == 1) renewed.emplace_back(run_id, token);
  }
  transaction.commit();
  return renewed;
}

bool ScreeningRepository::schedule_retry(const RunTask& task, const WorkerError& error, int delay_seconds) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto result = transaction.exec_params(
      R"SQL(UPDATE "ScreeningRun" SET status='RETRYING', "nextAttemptAt"=NOW()+($5*INTERVAL '1 second'),
             "errorCode"=$3, "errorMessage"=$4, "workerId"=NULL, "leaseExpiresAt"=NULL, "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, error.code(), error.what(), delay_seconds);
  transaction.commit();
  return result.affected_rows() == 1;
}

bool ScreeningRepository::mark_failed(const RunTask& task, const WorkerError& error) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto result = transaction.exec_params(
      R"SQL(UPDATE "ScreeningRun" SET status='FAILED', "errorCode"=$3, "errorMessage"=$4,
             "workerId"=NULL, "leaseExpiresAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, error.code(), error.what());
  transaction.commit();
  return result.affected_rows() == 1;
}

void ScreeningRepository::commit_result(const RunTask& task, const ScreeningExecutionResult& result) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto locked = transaction.exec_params(
      R"SQL(SELECT id FROM "ScreeningRun" WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING' FOR UPDATE)SQL",
      task.message.run_id, task.fencing_token);
  if (locked.empty()) throw WorkerError("LEASE_LOST", "提交结果前 lease 已失效", true);

  transaction.exec(R"SQL(CREATE TEMP TABLE screening_result_stage (stock_code TEXT NOT NULL, rank INTEGER NOT NULL) ON COMMIT DROP)SQL");
  {
    const std::vector<std::string> columns{"stock_code", "rank"};
    pqxx::stream_to stream(transaction, "screening_result_stage", columns);
    for (const auto& row : result.results) stream << std::make_tuple(row.stock_code, row.rank);
    stream.complete();
  }
  const auto validation = transaction.exec(
      R"SQL(SELECT COUNT(*) AS total, COUNT(DISTINCT stock_code) AS stocks, COUNT(DISTINCT rank) AS ranks,
                    COALESCE(MIN(rank), 0) AS min_rank, COALESCE(MAX(rank), 0) AS max_rank
             FROM screening_result_stage)SQL");
  const int count = validation[0][0].as<int>();
  if (count != result.total_count || validation[0][1].as<int>() != count || validation[0][2].as<int>() != count ||
      (count > 0 && (validation[0][3].as<int>() != 1 || validation[0][4].as<int>() != count))) {
    throw WorkerError("INVALID_RESULT_STAGE", "临时结果表校验失败", false);
  }

  transaction.exec_params(R"SQL(DELETE FROM "ScreeningRunResult" WHERE "runId"=$1)SQL", task.message.run_id);
  transaction.exec_params(
      R"SQL(INSERT INTO "ScreeningRunResult" (id, "runId", "stockCode", rank)
             SELECT $1 || ':' || rank::text, $1, stock_code, rank FROM screening_result_stage ORDER BY rank)SQL",
      task.message.run_id);
  const auto updated = transaction.exec_params(
      R"SQL(UPDATE "ScreeningRun" SET status=$3::"ScreeningRunStatus", "universeCount"=$4, "totalCount"=$5,
             warnings=$6::jsonb, diagnostics=$7::jsonb, "errorCode"=NULL, "errorMessage"=NULL,
             "workerId"=NULL, "leaseExpiresAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
             WHERE id=$1 AND "fencingToken"=$2 AND status='RUNNING')SQL",
      task.message.run_id, task.fencing_token, result.status, result.universe_count, result.total_count,
      result.warnings.dump(), result.diagnostics.dump());
  if (updated.affected_rows() != 1) throw WorkerError("LEASE_LOST", "提交终态时 lease 已失效", true);
  transaction.commit();
}

bool ScreeningRepository::ping() const {
  try {
    pqxx::connection connection(config_.database_url);
    pqxx::read_transaction transaction(connection);
    return transaction.exec("SELECT 1")[0][0].as<int>() == 1;
  } catch (...) {
    return false;
  }
}

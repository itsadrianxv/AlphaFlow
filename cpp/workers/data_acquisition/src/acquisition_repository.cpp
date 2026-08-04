#include "acquisition_repository.hpp"

#include <pqxx/pqxx>

namespace {
bool terminal_status(const std::string& status) {
  return status == "SUCCEEDED" || status == "FAILED" || status == "CANCELLED";
}

nlohmann::json failure_envelope(const task_lifecycle::Failure& failure, const AcquisitionTask& task,
                                bool retryable) {
  return nlohmann::json{
      {"contractVersion", task.input.provider_contract_version},
      {"datasetKey", task.input.dataset_key},
      {"providerKey", task.input.provider_key},
      {"resultStatus", "error"},
      {"qualityStatus", "isolated"},
      {"coverage", {{"requestedScope", task.input.fact_scope_json}, {"coveredScope", nlohmann::json::object()}, {"missingScope", task.input.fact_scope_json}}},
      {"actualDataCutoff", {{"key", task.input.target_data_cutoff_key}, {"value", task.input.target_data_cutoff_json.value("value", "")}}},
      {"errors",
       {{{"errorClass", failure.code},
         {"retryability", retryable ? "retryable" : "non_retryable"},
         {"message", failure.message}}}},
      {"resultHash", nullptr}};
}

const char* update_gate_sql() {
  return R"SQL(
    WITH manifest AS (
      SELECT item."manifestId" AS id
      FROM "HomepageDataManifestItem" item
      WHERE item.id = $1::text
    ),
    states AS (
      SELECT item.required, item."emptyPolicy", settlement."settlementStatus"
      FROM "HomepageDataManifestItem" item
      JOIN manifest ON manifest.id = item."manifestId"
      LEFT JOIN "HomepageDataManifestItemSettlement" settlement ON settlement."manifestItemId" = item.id
    ),
    projected AS (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM states WHERE "settlementStatus" IS NULL) THEN 'PENDING'
        WHEN EXISTS (
          SELECT 1 FROM states
          WHERE required AND NOT (
            "settlementStatus" = 'READY' OR ("settlementStatus" = 'EMPTY' AND "emptyPolicy" = 'ALLOW_EMPTY')
          )
        ) THEN 'BLOCKED'
        WHEN EXISTS (
          SELECT 1 FROM states
          WHERE NOT required AND COALESCE("settlementStatus", 'FAILED') <> 'READY'
        ) THEN 'READY_WITH_LIMITATION'
        ELSE 'READY'
      END AS gate
    )
    UPDATE "HomepageDataManifest" manifest
    SET "gateStatus" = projected.gate
    FROM projected
    WHERE manifest.id = (SELECT id FROM manifest)
  )SQL";
}
}  // namespace

AcquisitionClaimResult AcquisitionRepository::claim(const task_lifecycle::StreamMessage& message) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  const auto rows = transaction.exec_params(
      R"SQL(
        UPDATE "HomepageDataManifestItemAttempt" AS attempt
        SET status='RUNNING', attempts=attempt.attempts+1, "workerId"=$2,
            "fencingToken"=attempt."fencingToken"+1,
            "leaseExpiresAt"=NOW()+($3 * INTERVAL '1 second'),
            "heartbeatAt"=NOW(), "nextAttemptAt"=NULL,
            "startedAt"=COALESCE(attempt."startedAt", NOW()), "updatedAt"=NOW()
        FROM "HomepageDataManifestItem" item
        WHERE attempt.id=$1
          AND item.id=attempt."manifestItemId"
          AND attempt.attempts < $4
          AND NOT EXISTS (
            SELECT 1 FROM "HomepageDataManifestItemSettlement" settlement
            WHERE settlement."manifestItemId" = attempt."manifestItemId"
          )
          AND ((attempt.status IN ('PENDING','RETRY_WAIT') AND
                (attempt."nextAttemptAt" IS NULL OR attempt."nextAttemptAt" <= NOW()))
            OR (attempt.status='RUNNING' AND
                (attempt."leaseExpiresAt" IS NULL OR attempt."leaseExpiresAt" <= NOW())))
        RETURNING attempt.id, attempt."manifestItemId", item."datasetKey",
                  attempt."providerKey", attempt."providerContractVersion",
                  attempt."normalizationRulesVersion", attempt."idempotencyKey",
                  attempt."requestFingerprint", item."targetDataCutoffKey",
                  item."factScopeJson"::text, item."targetDataCutoffJson"::text,
                  attempt."fencingToken", attempt.attempts
      )SQL",
      message.run_id, config_.worker_id, config_.lease_seconds, config_.max_attempts);

  if (!rows.empty()) {
    AcquisitionAttemptInput input;
    input.attempt_id = rows[0][0].as<std::string>();
    input.manifest_item_id = rows[0][1].as<std::string>();
    input.dataset_key = rows[0][2].as<std::string>();
    input.provider_key = rows[0][3].as<std::string>();
    input.provider_contract_version = rows[0][4].as<std::string>();
    input.normalization_rules_version = rows[0][5].as<std::string>();
    input.idempotency_key = rows[0][6].as<std::string>();
    input.request_fingerprint = rows[0][7].as<std::string>();
    input.target_data_cutoff_key = rows[0][8].as<std::string>();
    input.fact_scope_json = nlohmann::json::parse(rows[0][9].as<std::string>());
    input.target_data_cutoff_json = nlohmann::json::parse(rows[0][10].as<std::string>());
    AcquisitionTask task{message, rows[0][11].as<std::int64_t>(), rows[0][12].as<int>(), std::move(input)};
    transaction.commit();
    return AcquisitionClaimResult::claimed(std::move(task));
  }

  const auto state = transaction.exec_params(
      R"SQL(SELECT status, attempts FROM "HomepageDataManifestItemAttempt" WHERE id=$1)SQL", message.run_id);
  transaction.commit();
  if (state.empty() || terminal_status(state[0][0].as<std::string>()) || state[0][1].as<int>() >= config_.max_attempts) {
    return AcquisitionClaimResult::discard();
  }
  return AcquisitionClaimResult::defer();
}

std::vector<task_lifecycle::Lease> AcquisitionRepository::renew(
    const std::vector<task_lifecycle::Lease>& leases) const {
  std::vector<task_lifecycle::Lease> renewed;
  if (leases.empty()) return renewed;
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);
  for (const auto& lease : leases) {
    const auto result = transaction.exec_params(
        R"SQL(UPDATE "HomepageDataManifestItemAttempt"
               SET "heartbeatAt"=NOW(), "leaseExpiresAt"=NOW()+($3 * INTERVAL '1 second'), "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND "workerId"=$4 AND status='RUNNING')SQL",
        lease.task_id, lease.fencing_token, config_.lease_seconds, config_.worker_id);
    if (result.affected_rows() == 1) renewed.push_back(lease);
  }
  transaction.commit();
  return renewed;
}

void AcquisitionRepository::settle(const AcquisitionTask& task, AcquisitionSettlement settlement) const {
  pqxx::connection connection(config_.database_url);
  pqxx::work transaction(connection);

  if (settlement.disposition == task_lifecycle::SettlementDisposition::retry &&
      task.attempt >= config_.max_attempts) {
    settlement.disposition = task_lifecycle::SettlementDisposition::terminal_failure;
    settlement.retry_delay = {};
  }

  if (settlement.disposition == task_lifecycle::SettlementDisposition::retry) {
    const auto& failure = *settlement.failure;
    const auto updated = transaction.exec_params(
        R"SQL(UPDATE "HomepageDataManifestItemAttempt"
               SET status='RETRY_WAIT', "nextAttemptAt"=NOW()+($4 * INTERVAL '1 second'),
                   "eventPublishedAt"=NULL,
                   "errorClass"=$3, retryability='RETRYABLE', "workerId"=NULL,
                   "leaseExpiresAt"=NULL, "updatedAt"=NOW()
               WHERE id=$1 AND "fencingToken"=$2 AND "workerId"=$5 AND status='RUNNING')SQL",
        task.message.run_id, task.fencing_token, failure.code, settlement.retry_delay.count(), config_.worker_id);
    if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入采集重试状态时 lease 已失效");
    transaction.exec_params(
        R"SQL(
          INSERT INTO "ResearchRuntimeObservation" (
            id, "idempotencyKey", "metricKind", "sourceKey", "datasetKey", stage,
            "resourcePoolKey", "productClockAt", "readyAt", success, degraded,
            "errorClass", "observationContextJson"
          )
          VALUES (
            'runtime:' || md5($1 || ':' || $2::text || ':retry'),
            'acquisition-attempt:' || $1 || ':' || $2::text || ':retry',
            'DATA', $3, $4, 'acquisition', $3, NOW(), NOW(), false, true, $5,
            jsonb_build_object(
              'taskId', $1,
              'taskType', 'homepage-data-acquisition',
              'inputContractVersion', $6::text,
              'inputHash', $7::text,
              'authoritativeObjectIds', jsonb_build_array($1),
              'retryAttempt', $8::int,
              'fencingToken', $2::text,
              'degradedReason', $5::text
            )
          )
          ON CONFLICT ("idempotencyKey") DO NOTHING
        )SQL",
        task.message.run_id, task.fencing_token, task.input.provider_key, task.input.dataset_key,
        failure.code, task.input.provider_contract_version, task.input.request_fingerprint, task.attempt);
    transaction.commit();
    return;
  }

  nlohmann::json envelope;
  bool completed = settlement.disposition == task_lifecycle::SettlementDisposition::completed;
  if (completed) {
    envelope = settlement.result->envelope;
  } else if (settlement.disposition == task_lifecycle::SettlementDisposition::obsolete) {
    envelope = failure_envelope({"ACQUISITION_OBSOLETE", "采集尝试已经失去执行资格"}, task, false);
  } else {
    envelope = failure_envelope(*settlement.failure, task, false);
  }

  const auto locked = transaction.exec_params(
      R"SQL(
        SELECT attempt.id
        FROM "HomepageDataManifestItemAttempt" attempt
        WHERE attempt.id=$1 AND attempt."fencingToken"=$2 AND attempt."workerId"=$3 AND attempt.status='RUNNING'
        FOR UPDATE
      )SQL",
      task.message.run_id, task.fencing_token, config_.worker_id);
  if (locked.empty()) {
    const auto existing = transaction.exec_params(
        R"SQL(SELECT 1 FROM "HomepageDataManifestItemSettlement" WHERE "settledAttemptId"=$1)SQL",
        task.message.run_id);
    if (!existing.empty()) {
      transaction.commit();
      return;
    }
    throw task_lifecycle::LeaseLost("提交采集结果前 lease 已失效");
  }

  const std::string envelope_text = envelope.dump();
  if (completed) {
    transaction.exec_params(
        R"SQL(
          WITH source_rows AS (
            SELECT value AS source
            FROM jsonb_array_elements(COALESCE(($1::jsonb)->'sourceAssertions', '[]'::jsonb))
          )
          INSERT INTO "SourceAssertion" (
            id, "assertionKey", "canonicalizationVersion", "sourceKey", "datasetKey",
            "sourceRecordKey", "observationIdentityKey", "rawRecordJson", "contentHash",
            "requestParamsHash", "providerVersion", "upstreamAsOf", "sourcePublishedAt", "fetchedAt"
          )
          SELECT
            'source:' || md5(source->>'assertionKey'),
            source->>'assertionKey',
            source->>'canonicalizationVersion',
            source->>'sourceKey',
            source->>'datasetKey',
            source->>'sourceRecordKey',
            source->>'observationIdentityKey',
            COALESCE(source->'rawRecord', '{}'::jsonb),
            source->>'contentHash',
            source->>'requestParamsHash',
            source->>'providerVersion',
            NULLIF(source->>'upstreamAsOf', '')::timestamptz,
            NULLIF(source->>'sourcePublishedAt', '')::timestamptz,
            COALESCE(NULLIF(source->>'fetchedAt', '')::timestamptz, NOW())
          FROM source_rows
          ON CONFLICT ("assertionKey") DO NOTHING
        )SQL",
        envelope_text);

    transaction.exec_params(
        R"SQL(
          WITH observation_rows AS (
            SELECT value AS obs
            FROM jsonb_array_elements(COALESCE(($1::jsonb)->'observations', '[]'::jsonb))
          ),
          normalized AS (
            SELECT
              obs,
              obs->>'identityKey' AS identity_key,
              CASE WHEN upper(COALESCE(obs->>'observationKind','INSTANT')) = 'PERIOD' THEN 'PERIOD' ELSE 'INSTANT' END AS observation_kind,
              COALESCE(
                NULLIF(obs#>>'{observationPeriod,date}', ''),
                NULLIF(obs#>>'{observationPeriod,tradeDate}', ''),
                NULLIF(($1::jsonb)#>>'{actualDataCutoff,value}', ''),
                '1970-01-01'
              ) AS observation_date,
              COALESCE(NULLIF(obs#>>'{observationPeriod,start}', ''), NULLIF(obs#>>'{observationPeriod,periodStart}', '')) AS period_start,
              COALESCE(NULLIF(obs#>>'{observationPeriod,end}', ''), NULLIF(obs#>>'{observationPeriod,periodEnd}', '')) AS period_end
            FROM observation_rows
          )
          INSERT INTO "DataObservation" (
            id, "identityKey", "canonicalizationVersion", "subjectType", "subjectKey",
            "metricCatalogId", "dimensionsJson", "observationKind", "observationDate",
            "periodStart", "periodEnd"
          )
          SELECT
            'obs:' || md5(identity_key),
            identity_key,
            obs->>'canonicalizationVersion',
            obs->>'subjectType',
            obs->>'subjectKey',
            obs->>'metricCatalogId',
            COALESCE(obs->'dimensions', '{}'::jsonb),
            observation_kind,
            CASE WHEN observation_kind = 'INSTANT' THEN observation_date::date ELSE NULL END,
            CASE WHEN observation_kind = 'PERIOD' THEN COALESCE(period_start, observation_date)::date ELSE NULL END,
            CASE WHEN observation_kind = 'PERIOD' THEN COALESCE(period_end, observation_date)::date ELSE NULL END
          FROM normalized
          ON CONFLICT ("identityKey") DO NOTHING
        )SQL",
        envelope_text);

    transaction.exec_params(
        R"SQL(
          WITH observation_rows AS (
            SELECT value AS obs, row_number() OVER () - 1 AS ordinal
            FROM jsonb_array_elements(COALESCE(($1::jsonb)->'observations', '[]'::jsonb))
          ),
          prepared AS (
            SELECT
              obs,
              o.id AS observation_id,
              'rev:' || md5(jsonb_build_object(
                'identityKey', obs->>'identityKey',
                'valueText', obs->>'valueText',
                'valueJson', obs->'valueJson',
                'missingReason', obs->>'missingReason',
                'normalizationRulesVersion', ($1::jsonb)->>'normalizationRulesVersion'
              )::text) AS revision_id,
              'sha256:' || md5(jsonb_build_object(
                'identityKey', obs->>'identityKey',
                'valueText', obs->>'valueText',
                'valueJson', obs->'valueJson',
                'missingReason', obs->>'missingReason',
                'normalizationRulesVersion', ($1::jsonb)->>'normalizationRulesVersion'
              )::text) AS revision_dedup_key
            FROM observation_rows
            JOIN "DataObservation" o ON o."identityKey" = obs->>'identityKey'
          ),
          current_state AS (
            SELECT prepared.*, o."currentRevisionId", current_rev."revisionNo" AS current_revision_no
            FROM prepared
            JOIN "DataObservation" o ON o.id = prepared.observation_id
            LEFT JOIN "DataObservationRevision" current_rev ON current_rev.id = o."currentRevisionId"
            FOR UPDATE OF o
          ),
          inserted AS (
            INSERT INTO "DataObservationRevision" (
              id, "observationId", "revisionNo", "revisionDedupKey", "canonicalizationVersion",
              "valueType", "valueText", "valueJson", unit, precision, "missingReason",
              "qualityStatus", "valueHash", "normalizationRulesVersion", "supersedesRevisionId",
              "upstreamAsOf", "sourcePublishedAt", "normalizedAt"
            )
            SELECT
              revision_id,
              observation_id,
              COALESCE(current_revision_no, 0) + 1,
              revision_dedup_key,
              obs->>'canonicalizationVersion',
              COALESCE(obs->>'valueType', 'json'),
              obs->>'valueText',
              obs->'valueJson',
              obs->>'unit',
              NULLIF(obs->>'precision', '')::int,
              obs->>'missingReason',
              upper(COALESCE(obs->>'qualityStatus', 'normal')),
              'sha256:' || md5(jsonb_build_object('valueText', obs->>'valueText', 'valueJson', obs->'valueJson', 'missingReason', obs->>'missingReason')::text),
              ($1::jsonb)->>'normalizationRulesVersion',
              "currentRevisionId",
              NULLIF(($1::jsonb)->>'upstreamAsOf', '')::timestamptz,
              NULLIF(($1::jsonb)->>'sourcePublishedAt', '')::timestamptz,
              COALESCE(NULLIF(($1::jsonb)->>'normalizedAt', '')::timestamptz, NOW())
            FROM current_state
            WHERE "currentRevisionId" IS DISTINCT FROM revision_id
            ON CONFLICT ("revisionDedupKey") DO NOTHING
            RETURNING id, "observationId"
           ),
           all_revisions AS (
             SELECT id, "observationId" FROM inserted
             UNION
             SELECT r.id, r."observationId"
             FROM "DataObservationRevision" r
             JOIN prepared p ON p.revision_dedup_key = r."revisionDedupKey"
           )
          UPDATE "DataObservation" o
          SET "currentRevisionId" = all_revisions.id
          FROM all_revisions
          WHERE o.id = all_revisions."observationId"
            AND (o."currentRevisionId" IS NULL OR o."currentRevisionId" <> all_revisions.id)
        )SQL",
        envelope_text);

    transaction.exec_params(
        R"SQL(
          WITH observation_rows AS (
            SELECT value AS obs
            FROM jsonb_array_elements(COALESCE(($1::jsonb)->'observations', '[]'::jsonb))
          ),
          revision_source_rows AS (
            SELECT
              r.id AS revision_id,
              s.id AS source_id,
              CASE WHEN s."sourceKey" = COALESCE(($1::jsonb)#>>'{authority,selectedSourceKey}', s."sourceKey") THEN 'SELECTED' ELSE 'CORROBORATING' END AS role
            FROM observation_rows o
            JOIN "DataObservation" obs ON obs."identityKey" = o.obs->>'identityKey'
            JOIN "DataObservationRevision" r ON r.id = obs."currentRevisionId"
            JOIN "SourceAssertion" s ON s."observationIdentityKey" = obs."identityKey"
          )
          INSERT INTO "DataObservationRevisionSource" (
            "revisionId", "sourceAssertionId", role, "authorityStrategyVersion", "selectionReason", "fallbackReason"
          )
          SELECT revision_id, source_id, role,
                 COALESCE(($1::jsonb)#>>'{authority,strategyVersion}', 'authority-1'),
                 COALESCE(($1::jsonb)#>>'{authority,selectionReason}', 'Provider 已完成权威来源选择'),
                 ($1::jsonb)#>>'{authority,fallbackReason}'
          FROM revision_source_rows
          ON CONFLICT DO NOTHING
        )SQL",
        envelope_text);
  }

  const auto settled = transaction.exec_params(
      R"SQL(
        WITH attempt AS (
          SELECT attempt.*, item.required, item."emptyPolicy", item."targetDataCutoffKey", item."targetDataCutoffJson"
          FROM "HomepageDataManifestItemAttempt" attempt
          JOIN "HomepageDataManifestItem" item ON item.id = attempt."manifestItemId"
          WHERE attempt.id=$1 AND attempt."fencingToken"=$2 AND attempt."workerId"=$4 AND attempt.status='RUNNING'
          FOR UPDATE
        ),
        first_revision AS (
          SELECT o."currentRevisionId" AS revision_id
          FROM jsonb_array_elements(COALESCE(($3::jsonb)->'observations', '[]'::jsonb)) WITH ORDINALITY AS entry(obs, ordinal)
          JOIN "DataObservation" o ON o."identityKey" = entry.obs->>'identityKey'
          ORDER BY entry.ordinal
          LIMIT 1
        ),
        status_projection AS (
          SELECT CASE
            WHEN ($3::jsonb)->>'resultStatus' = 'error' THEN 'FAILED'
            WHEN ($3::jsonb)->>'resultStatus' = 'empty' THEN 'EMPTY'
            WHEN ($3::jsonb)->>'resultStatus' = 'success' AND upper(COALESCE(($3::jsonb)->>'qualityStatus', 'normal')) = 'NORMAL'
              AND COALESCE(($3::jsonb)#>>'{actualDataCutoff,value}', '') >= COALESCE((SELECT "targetDataCutoffJson"->>'value' FROM attempt), '')
              THEN 'READY'
            ELSE 'DEGRADED'
          END AS settlement_status
        ),
        inserted AS (
          INSERT INTO "HomepageDataManifestItemSettlement" (
            id, "manifestItemId", "settledAttemptId", "settledFencingToken", "selectedRevisionId",
            "settlementStatus", "providerResultStatus", "requestedScopeJson", "coveredScopeJson",
            "missingScopeJson", "targetDataCutoffKey", "targetDataCutoffJson", "actualDataCutoffKey",
            "actualDataCutoffJson", "qualityStatus", "errorClass", retryability, "settledAt"
          )
          SELECT
            'settlement:' || md5(attempt."manifestItemId"),
            attempt."manifestItemId",
            attempt.id,
            attempt."fencingToken",
            (SELECT revision_id FROM first_revision),
            status_projection.settlement_status,
            ($3::jsonb)->>'resultStatus',
            COALESCE(($3::jsonb)#>'{coverage,requestedScope}', '{}'::jsonb),
            COALESCE(($3::jsonb)#>'{coverage,coveredScope}', '{}'::jsonb),
            COALESCE(($3::jsonb)#>'{coverage,missingScope}', '{}'::jsonb),
            attempt."targetDataCutoffKey",
            attempt."targetDataCutoffJson",
            COALESCE(($3::jsonb)#>>'{actualDataCutoff,key}', attempt."targetDataCutoffKey"),
            COALESCE(($3::jsonb)#>'{actualDataCutoff}', attempt."targetDataCutoffJson"),
            upper(COALESCE(($3::jsonb)->>'qualityStatus', 'isolated')),
            COALESCE(($3::jsonb)#>>'{errors,0,errorClass}', CASE WHEN ($3::jsonb)->>'resultStatus' = 'error' THEN 'provider_error' END),
            CASE
              WHEN ($3::jsonb)#>>'{errors,0,retryability}' = 'retryable' THEN 'RETRYABLE'
              WHEN ($3::jsonb)#>>'{errors,0,retryability}' IS NOT NULL THEN 'NON_RETRYABLE'
              ELSE NULL
            END,
            NOW()
          FROM attempt, status_projection
          ON CONFLICT ("manifestItemId") DO NOTHING
          RETURNING id
        )
        SELECT id FROM inserted
      )SQL",
      task.message.run_id, task.fencing_token, envelope_text, config_.worker_id);

  transaction.exec_params(
      R"SQL(
        WITH settlement AS (
          SELECT id FROM "HomepageDataManifestItemSettlement" WHERE "settledAttemptId"=$1
        ),
        revision_rows AS (
          SELECT settlement.id AS settlement_id, o."currentRevisionId" AS revision_id, entry.ordinal - 1 AS ordinal
          FROM settlement
          CROSS JOIN jsonb_array_elements(COALESCE(($2::jsonb)->'observations', '[]'::jsonb)) WITH ORDINALITY AS entry(obs, ordinal)
          JOIN "DataObservation" o ON o."identityKey" = entry.obs->>'identityKey'
          WHERE o."currentRevisionId" IS NOT NULL
        )
        INSERT INTO "HomepageDataManifestItemSettlementRevision" (
          "settlementId", "observationRevisionId", ordinal
        )
        SELECT settlement_id, revision_id, ordinal
        FROM revision_rows
        ON CONFLICT DO NOTHING
      )SQL",
      task.message.run_id, envelope_text);

  const std::string result_status = envelope.value("resultStatus", "error");
  const std::string result_hash =
      envelope.contains("resultHash") && envelope["resultHash"].is_string() ? envelope["resultHash"].get<std::string>() : "";
  const std::string retryability = envelope.contains("errors") && envelope["errors"].is_array() && !envelope["errors"].empty()
                                      ? (envelope["errors"][0].value("retryability", "") == "retryable" ? "RETRYABLE" : "NON_RETRYABLE")
                                      : "";
  const auto updated = transaction.exec_params(
      R"SQL(
        UPDATE "HomepageDataManifestItemAttempt"
        SET status=$5, "resultStatus"=$6, "resultEnvelopeJson"=$3::jsonb,
            "resultHash"=NULLIF($7, ''), "errorClass"=NULLIF($8, ''),
            retryability=NULLIF($9, ''), "workerId"=NULL, "leaseExpiresAt"=NULL,
            "nextAttemptAt"=NULL, "completedAt"=NOW(), "updatedAt"=NOW()
        WHERE id=$1 AND "fencingToken"=$2 AND "workerId"=$4 AND status='RUNNING'
      )SQL",
      task.message.run_id, task.fencing_token, envelope_text, config_.worker_id,
      completed ? "SUCCEEDED" : (settlement.disposition == task_lifecycle::SettlementDisposition::obsolete ? "CANCELLED" : "FAILED"),
      result_status, result_hash, envelope.contains("errors") && envelope["errors"].is_array() && !envelope["errors"].empty()
                                             ? envelope["errors"][0].value("errorClass", "")
                                             : "",
      retryability);
  if (updated.affected_rows() != 1) throw task_lifecycle::LeaseLost("写入采集终态时 lease 已失效");

  if (!settled.empty()) transaction.exec_params(update_gate_sql(), task.input.manifest_item_id);
  transaction.exec_params(
      R"SQL(
        INSERT INTO "ResearchRuntimeObservation" (
          id, "idempotencyKey", "metricKind", "sourceKey", "datasetKey", stage,
          "resourcePoolKey", "productClockAt", "readyAt", success, degraded,
          "errorClass", "observationContextJson"
        )
        SELECT
          'runtime:' || md5('acquisition-settlement:' || attempt.id),
          'acquisition-settlement:' || attempt.id,
          'DATA', attempt."providerKey", item."datasetKey", 'acquisition',
          attempt."providerKey", COALESCE(attempt."startedAt", NOW()), NOW(),
          attempt.status = 'SUCCEEDED', settlement."settlementStatus" = 'DEGRADED',
          settlement."errorClass",
          jsonb_strip_nulls(jsonb_build_object(
            'taskId', attempt.id,
            'taskType', 'homepage-data-acquisition',
            'inputContractVersion', attempt."providerContractVersion",
            'inputHash', attempt."requestFingerprint",
            'resultContractVersion', ($2::jsonb)->>'contractVersion',
            'resultHash', NULLIF(($2::jsonb)->>'resultHash', ''),
            'authoritativeObjectIds',
              jsonb_build_array(attempt.id, settlement.id) ||
              CASE WHEN settlement."selectedRevisionId" IS NULL
                THEN '[]'::jsonb
                ELSE jsonb_build_array(settlement."selectedRevisionId")
              END,
            'retryAttempt', attempt.attempts,
            'fencingToken', attempt."fencingToken"::text,
            'degradedReason', CASE
              WHEN settlement."settlementStatus" <> 'READY' THEN settlement."settlementStatus"
              ELSE NULL
            END
          ))
        FROM "HomepageDataManifestItemAttempt" attempt
        JOIN "HomepageDataManifestItem" item ON item.id = attempt."manifestItemId"
        JOIN "HomepageDataManifestItemSettlement" settlement ON settlement."settledAttemptId" = attempt.id
        WHERE attempt.id = $1
        ON CONFLICT ("idempotencyKey") DO NOTHING
      )SQL",
      task.message.run_id, envelope_text);
  transaction.commit();
}

bool AcquisitionRepository::ping() const {
  try {
    pqxx::connection connection(config_.database_url);
    pqxx::read_transaction transaction(connection);
    return transaction.exec("SELECT 1")[0][0].as<int>() == 1;
  } catch (...) {
    return false;
  }
}

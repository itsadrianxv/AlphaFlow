import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究信息权威关系模型 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: contractDatabaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("并发重复来源断言只保留一个权威事实", async () => {
    const assertionKey = key("assertion");
    const identityKey = key("observation");

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        db.$executeRawUnsafe(
          `INSERT INTO "SourceAssertion" (
             "id", "assertionKey", "canonicalizationVersion", "sourceKey", "datasetKey",
             "sourceRecordKey", "observationIdentityKey", "rawRecordJson", "contentHash",
             "requestParamsHash", "providerVersion", "fetchedAt"
           ) VALUES ($1, $2, 'v1', 'tushare', 'daily_price', 'record-1', $3, $4::jsonb,
             'sha256:content', 'sha256:request', 'provider-v1', CURRENT_TIMESTAMP)
           ON CONFLICT ("assertionKey") DO NOTHING`,
          key(`source-${index}`),
          assertionKey,
          identityKey,
          JSON.stringify({ close: "10.00" }),
        ),
      ),
    );

    const rows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "SourceAssertion" WHERE "assertionKey" = $1`,
      assertionKey,
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("拒绝改写历史、第二个选定来源和删除被引用观测", async () => {
    const observationId = key("observation-id");
    const identityKey = key("identity");
    const revisionId = key("revision");
    const sourceOneId = key("source-one");
    const sourceTwoId = key("source-two");

    await db.$executeRawUnsafe(
      `INSERT INTO "DataObservation" (
         "id", "identityKey", "canonicalizationVersion", "subjectType", "subjectKey",
         "metricCatalogId", "observationKind", "observationDate"
       ) VALUES ($1, $2, 'v1', 'COMPANY', '000001.SZ', 'close', 'INSTANT', DATE '2026-08-01')`,
      observationId,
      identityKey,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "DataObservationRevision" (
         "id", "observationId", "revisionNo", "revisionDedupKey", "canonicalizationVersion",
         "valueType", "valueText", "unit", "qualityStatus", "valueHash",
         "normalizationRulesVersion", "normalizedAt"
       ) VALUES ($1, $2, 1, $3, 'v1', 'DECIMAL', '10.00', 'CNY', 'NORMAL',
         'sha256:value', 'rules-v1', CURRENT_TIMESTAMP)`,
      revisionId,
      observationId,
      key("revision-dedup"),
    );

    for (const [sourceId, sourceKey] of [
      [sourceOneId, "tushare"],
      [sourceTwoId, "minishare"],
    ] as const) {
      await db.$executeRawUnsafe(
        `INSERT INTO "SourceAssertion" (
           "id", "assertionKey", "canonicalizationVersion", "sourceKey", "datasetKey",
           "sourceRecordKey", "observationIdentityKey", "rawRecordJson", "contentHash",
           "requestParamsHash", "providerVersion", "fetchedAt"
         ) VALUES ($1, $2, 'v1', $3, 'daily_price', $4, $5, '{}'::jsonb,
           'sha256:content', 'sha256:request', 'provider-v1', CURRENT_TIMESTAMP)`,
        sourceId,
        key("assertion"),
        sourceKey,
        key("record"),
        identityKey,
      );
    }

    await db.$executeRawUnsafe(
      `INSERT INTO "DataObservationRevisionSource" (
         "revisionId", "sourceAssertionId", "role", "authorityStrategyVersion", "selectionReason"
       ) VALUES ($1, $2, 'SELECTED', 'authority-v1', '主来源')`,
      revisionId,
      sourceOneId,
    );

    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "DataObservationRevisionSource" (
           "revisionId", "sourceAssertionId", "role", "authorityStrategyVersion", "selectionReason"
         ) VALUES ($1, $2, 'SELECTED', 'authority-v1', '另一个主来源')`,
        revisionId,
        sourceTwoId,
      ),
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "SourceAssertion" SET "providerVersion" = 'tampered' WHERE "id" = $1`,
        sourceOneId,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRawUnsafe(`DELETE FROM "DataObservation" WHERE "id" = $1`, observationId),
    ).rejects.toThrow();
  });

  it("阻断非法个性化父清单和对父基线项的覆盖", async () => {
    const blockedBaselineId = key("blocked-baseline");
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifest" (
         "id", "manifestKey", "canonicalizationVersion", "scope", "definitionVersion",
         "targetContextKey", "targetContextJson", "gateStatus"
       ) VALUES ($1, $2, 'v1', 'BASELINE', 'definition-v1', $3, '{}'::jsonb, 'BLOCKED')`,
      blockedBaselineId,
      key("manifest"),
      key("target"),
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "HomepageDataManifest" (
           "id", "manifestKey", "canonicalizationVersion", "scope", "definitionVersion",
           "targetContextKey", "targetContextJson", "userId", "baseManifestId",
           "frozenPreferenceContractVersion", "frozenPreferenceJson"
         ) VALUES ($1, $2, 'v1', 'PERSONALIZED', 'definition-v1', $3, '{}'::jsonb,
           'missing-user', $4, 'v1', '{}'::jsonb)`,
        key("personalized"),
        key("manifest"),
        key("target"),
        blockedBaselineId,
      ),
    ).rejects.toThrow(/ready baseline/);

    const baselineId = key("ready-baseline");
    const itemKey = key("item");
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifest" (
         "id", "manifestKey", "canonicalizationVersion", "scope", "definitionVersion",
         "targetContextKey", "targetContextJson", "gateStatus"
       ) VALUES ($1, $2, 'v1', 'BASELINE', 'definition-v1', $3, '{}'::jsonb, 'READY')`,
      baselineId,
      key("manifest"),
      key("target"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifestItem" (
         "id", "manifestId", "itemKey", "canonicalizationVersion", "datasetKey",
         "factScopeKey", "factScopeJson", "requirementVersion", "required", "emptyPolicy",
         "targetDataCutoffKey", "targetDataCutoffJson"
       ) VALUES ($1, $2, $3, 'v1', 'daily_price', 'all-a-shares', '{}'::jsonb,
         'requirements-v1', TRUE, 'REQUIRE_NON_EMPTY', '2026-08-01', '{}'::jsonb)`,
      key("baseline-item"),
      baselineId,
      itemKey,
    );

    const userId = key("user");
    await db.$executeRawUnsafe(`INSERT INTO "User" ("id") VALUES ($1)`, userId);
    const personalizedId = key("personalized");
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifest" (
         "id", "manifestKey", "canonicalizationVersion", "scope", "definitionVersion",
         "targetContextKey", "targetContextJson", "userId", "baseManifestId",
         "frozenPreferenceContractVersion", "frozenPreferenceJson"
       ) VALUES ($1, $2, 'v1', 'PERSONALIZED', 'definition-v1', $3, '{}'::jsonb,
         $4, $5, 'v1', '{}'::jsonb)`,
      personalizedId,
      key("manifest"),
      key("target"),
      userId,
      baselineId,
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "HomepageDataManifestItem" (
           "id", "manifestId", "itemKey", "canonicalizationVersion", "datasetKey",
           "factScopeKey", "factScopeJson", "requirementVersion", "required", "emptyPolicy",
           "targetDataCutoffKey", "targetDataCutoffJson"
         ) VALUES ($1, $2, $3, 'v1', 'daily_price', 'all-a-shares', '{}'::jsonb,
           'requirements-v1', TRUE, 'REQUIRE_NON_EMPTY', '2026-08-01', '{}'::jsonb)`,
        key("personalized-item"),
        personalizedId,
        itemKey,
      ),
    ).rejects.toThrow(/cannot override/);
  });

  it("旧 fencing token 不能写入清单项结算", async () => {
    const manifestId = key("manifest");
    const itemId = key("item");
    const attemptId = key("attempt");

    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifest" (
         "id", "manifestKey", "canonicalizationVersion", "scope", "definitionVersion",
         "targetContextKey", "targetContextJson", "gateStatus"
       ) VALUES ($1, $2, 'v1', 'BASELINE', 'definition-v1', $3, '{}'::jsonb, 'PENDING')`,
      manifestId,
      key("manifest-key"),
      key("target"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifestItem" (
         "id", "manifestId", "itemKey", "canonicalizationVersion", "datasetKey",
         "factScopeKey", "factScopeJson", "requirementVersion", "required", "emptyPolicy",
         "targetDataCutoffKey", "targetDataCutoffJson"
       ) VALUES ($1, $2, $3, 'v1', 'news', 'market', '{}'::jsonb, 'requirements-v1',
         FALSE, 'ALLOW_EMPTY', '2026-08-01', '{}'::jsonb)`,
      itemId,
      manifestId,
      key("item-key"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "HomepageDataManifestItemAttempt" (
         "id", "manifestItemId", "attemptNo", "idempotencyKey", "providerKey",
         "providerContractVersion", "normalizationRulesVersion", "requestFingerprint",
         "status", "workerId", "fencingToken", "leaseExpiresAt"
       ) VALUES ($1, $2, 1, $3, 'minishare', '1.0', 'rules-v1', 'sha256:request',
         'RUNNING', 'worker-new', 2, CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
      attemptId,
      itemId,
      key("attempt-key"),
    );

    const settlementSql = `INSERT INTO "HomepageDataManifestItemSettlement" (
       "id", "manifestItemId", "settledAttemptId", "settledFencingToken", "settlementStatus",
       "providerResultStatus", "requestedScopeJson", "coveredScopeJson", "missingScopeJson",
       "targetDataCutoffKey", "targetDataCutoffJson", "actualDataCutoffKey",
       "actualDataCutoffJson", "qualityStatus", "settledAt"
     ) VALUES ($1, $2, $3, $4, 'EMPTY', 'empty', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb,
       '2026-08-01', '{}'::jsonb, '2026-08-01', '{}'::jsonb, 'NORMAL', CURRENT_TIMESTAMP)`;

    await expect(
      db.$executeRawUnsafe(settlementSql, key("stale-settlement"), itemId, attemptId, 1),
    ).rejects.toThrow(/STALE_FENCING/);
    await expect(
      db.$executeRawUnsafe(settlementSql, key("valid-settlement"), itemId, attemptId, 2),
    ).resolves.toBe(1);
  });

  it("资源许可拒绝跨池、旧 fencing 和超出当前并发", async () => {
    const poolOneId = key("pool-one");
    const poolTwoId = key("pool-two");
    const taskOneId = key("task-one");
    const taskTwoId = key("task-two");
    const now = new Date();

    for (const [poolId, poolKey] of [
      [poolOneId, key("pool-key-one")],
      [poolTwoId, key("pool-key-two")],
    ] as const) {
      await db.$executeRawUnsafe(
        `INSERT INTO "ResearchResourcePool" (
           "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency"
         ) VALUES ($1, $2, 'provider', 1, 1)`,
        poolId,
        poolKey,
      );
    }

    const insertTask = async (taskId: string, poolId: string, fencingToken: number) =>
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchTask" (
           "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
           "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "maxAttempts",
           "retryDeadline", "status", "fencingToken"
         ) VALUES ($1, 'provider-fetch', $2, 'sha256:input', 'v1', '{}'::jsonb,
           'BACKGROUND', $3, $4, 1, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'RUNNING', $5)`,
        taskId,
        key("task-idempotency"),
        poolId,
        key("fairness"),
        fencingToken,
      );

    await insertTask(taskOneId, poolOneId, 7);
    await insertTask(taskTwoId, poolOneId, 3);

    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchResourcePermit" (
           "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
           "acquiredAt", "leaseExpiresAt"
         ) VALUES ($1, $2, $3, $4, 'worker', 6, $5, $5 + INTERVAL '1 minute')`,
        key("stale-permit"),
        poolOneId,
        taskOneId,
        key("permit-stale"),
        now,
      ),
    ).rejects.toThrow(/fencing token is stale/);

    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchResourcePermit" (
           "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
           "acquiredAt", "leaseExpiresAt"
         ) VALUES ($1, $2, $3, $4, 'worker', 7, $5, $5 + INTERVAL '1 minute')`,
        key("cross-pool-permit"),
        poolTwoId,
        taskOneId,
        key("permit-cross-pool"),
        now,
      ),
    ).rejects.toThrow(/task resource pool/);

    const permitOneId = key("permit-one");
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchResourcePermit" (
         "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
         "acquiredAt", "leaseExpiresAt"
       ) VALUES ($1, $2, $3, $4, 'worker', 7, $5, $5 + INTERVAL '1 minute')`,
      permitOneId,
      poolOneId,
      taskOneId,
      key("permit-valid"),
      now,
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchResourcePermit" (
           "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
           "acquiredAt", "leaseExpiresAt"
         ) VALUES ($1, $2, $3, $4, 'worker', 3, $5, $5 + INTERVAL '1 minute')`,
        key("capacity-permit"),
        poolOneId,
        taskTwoId,
        key("permit-capacity"),
        now,
      ),
    ).rejects.toThrow(/capacity exceeded/);

    await db.$executeRawUnsafe(
      `UPDATE "ResearchResourcePermit"
       SET "status" = 'RELEASED', "releasedAt" = CURRENT_TIMESTAMP, "releaseReason" = 'done'
       WHERE "id" = $1`,
      permitOneId,
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchResourcePermit" (
           "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
           "acquiredAt", "leaseExpiresAt"
         ) VALUES ($1, $2, $3, $4, 'worker', 3, $5, $5 + INTERVAL '1 minute')`,
        key("capacity-after-release"),
        poolOneId,
        taskTwoId,
        key("permit-after-release"),
        now,
      ),
    ).resolves.toBe(1);
  });

  it("用户归属约束阻断跨用户相关性评估和收件箱反馈", async () => {
    const ownerUserId = key("owner-user");
    const otherUserId = key("other-user");
    const eventId = key("binding-event");
    const revisionId = key("binding-revision");
    const snapshotId = key("binding-snapshot");
    const entryId = key("binding-entry");

    await db.$executeRawUnsafe(`INSERT INTO "User" ("id") VALUES ($1), ($2)`, ownerUserId, otherUserId);
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEvent" (
         "id", "eventKey", "canonicalizationVersion", "subjectType", "subjectKey"
       ) VALUES ($1, $2, 'v1', 'COMPANY', '000002.SZ')`,
      eventId,
      key("binding-event-key"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEventRevision" (
         "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind", "title",
         "summary", "narrativeJson", "uncertaintyJson", "counterEvidenceJson",
         "occurredAt", "knownAt"
       ) VALUES ($1, $2, 1, $3, 'CONFIRMED', '绑定事件', '摘要', '{}'::jsonb,
         '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      revisionId,
      eventId,
      key("binding-revision-key"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchPreferenceSnapshot" (
         "id", "userId", "contractVersion", "enabled", "urgentAlertsEnabled",
         "briefingsEnabled", "externalCopiesEnabled", "contentHash", "frozenAt"
       ) VALUES ($1, $2, 'v1', TRUE, TRUE, TRUE, TRUE, 'sha256:snapshot', CURRENT_TIMESTAMP)`,
      snapshotId,
      ownerUserId,
    );

    const assessmentSql = `INSERT INTO "ResearchEventRelevanceAssessment" (
       "id", "eventRevisionId", "userId", "preferenceSnapshotId", "inputHash",
       "contractVersion", "model", "promptVersion", "schemaVersion", "usageJson"
     ) VALUES ($1, $2, $3, $4, $5, 'v1', 'deepseek-v4-flash', 'prompt-v1', 'schema-v1', '{}'::jsonb)`;
    await expect(
      db.$executeRawUnsafe(
        assessmentSql,
        key("cross-user-assessment"),
        revisionId,
        otherUserId,
        snapshotId,
        `sha256:${key("cross-user-assessment-input")}`,
      ),
    ).rejects.toThrow(/preference snapshot user/);
    await expect(
      db.$executeRawUnsafe(
        assessmentSql,
        key("valid-assessment"),
        revisionId,
        ownerUserId,
        snapshotId,
        `sha256:${key("valid-assessment-input")}`,
      ),
    ).resolves.toBe(1);

    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchInboxEntry" (
         "id", "distributionKey", "userId", "eventRevisionId", "highestChannel",
         "entryKind", "title", "summary", "bodyJson"
       ) VALUES ($1, $2, $3, $4, 'IN_APP', 'EVENT', '绑定事件', '摘要', '{}'::jsonb)`,
      entryId,
      key("binding-distribution"),
      ownerUserId,
      revisionId,
    );
    const feedbackSql = `INSERT INTO "ResearchInboxFeedback" (
       "id", "entryId", "userId", "value", "commandId"
     ) VALUES ($1, $2, $3, 'USEFUL', $4)`;
    await expect(
      db.$executeRawUnsafe(
        feedbackSql,
        key("cross-user-feedback"),
        entryId,
        otherUserId,
        key("cross-user-feedback-command"),
      ),
    ).rejects.toThrow(/inbox entry user/);
    await expect(
      db.$executeRawUnsafe(
        feedbackSql,
        key("valid-feedback"),
        entryId,
        ownerUserId,
        key("valid-feedback-command"),
      ),
    ).resolves.toBe(1);
  });

  it("事件修订与收件箱历史追加保留且权威正文不可改写", async () => {
    const userId = key("user");
    const eventId = key("event");
    const firstRevisionId = key("event-revision");
    const correctionRevisionId = key("event-correction");
    const inboxEntryId = key("inbox-entry");
    const historyId = key("inbox-history");

    await db.$executeRawUnsafe(`INSERT INTO "User" ("id") VALUES ($1)`, userId);
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEvent" (
         "id", "eventKey", "canonicalizationVersion", "subjectType", "subjectKey"
       ) VALUES ($1, $2, 'v1', 'COMPANY', '000001.SZ')`,
      eventId,
      key("event-key"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEventRevision" (
         "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind", "title",
         "summary", "narrativeJson", "uncertaintyJson", "counterEvidenceJson",
         "occurredAt", "knownAt"
       ) VALUES ($1, $2, 1, $3, 'CONFIRMED', '事件标题', '事件摘要', '{}'::jsonb,
         '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      firstRevisionId,
      eventId,
      key("event-revision-key"),
    );
    await db.$executeRawUnsafe(
      `UPDATE "ResearchEvent" SET "currentRevisionId" = $1 WHERE "id" = $2`,
      firstRevisionId,
      eventId,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchInboxEntry" (
         "id", "distributionKey", "userId", "eventRevisionId", "highestChannel",
         "entryKind", "title", "summary", "bodyJson"
       ) VALUES ($1, $2, $3, $4, 'IN_APP', 'EVENT', '事件标题', '事件摘要', '{}'::jsonb)`,
      inboxEntryId,
      key("distribution"),
      userId,
      firstRevisionId,
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchInboxEntryHistory" (
         "id", "entryId", "sequence", "toState", "action", "commandId", "occurredAt"
       ) VALUES ($1, $2, 1, 'UNREAD', 'CREATED', $3, CURRENT_TIMESTAMP)`,
      historyId,
      inboxEntryId,
      key("command"),
    );

    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchEventRevision" SET "summary" = '被改写' WHERE "id" = $1`,
        firstRevisionId,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchInboxEntryHistory" SET "action" = 'TAMPERED' WHERE "id" = $1`,
        historyId,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchInboxEntry" SET "title" = '被改写' WHERE "id" = $1`,
        inboxEntryId,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchInboxEntry" SET "state" = 'READ', "openedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        inboxEntryId,
      ),
    ).resolves.toBe(1);

    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEventRevision" (
         "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind",
         "supersedesRevisionId", "title", "summary", "narrativeJson", "uncertaintyJson",
         "counterEvidenceJson", "occurredAt", "knownAt"
       ) VALUES ($1, $2, 2, $3, 'CORRECTED', $4, '更正：事件标题', '更正后的摘要',
         '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      correctionRevisionId,
      eventId,
      key("event-revision-key"),
      firstRevisionId,
    );

    const otherEventId = key("other-event");
    const otherRevisionId = key("other-event-revision");
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEvent" (
         "id", "eventKey", "canonicalizationVersion", "subjectType", "subjectKey"
       ) VALUES ($1, $2, 'v1', 'COMPANY', '000003.SZ')`,
      otherEventId,
      key("other-event-key"),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEventRevision" (
         "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind", "title",
         "summary", "narrativeJson", "uncertaintyJson", "counterEvidenceJson",
         "occurredAt", "knownAt"
       ) VALUES ($1, $2, 1, $3, 'CONFIRMED', '另一个事件', '摘要', '{}'::jsonb,
         '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      otherRevisionId,
      otherEventId,
      key("other-event-revision-key"),
    );
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchEventRevision" (
           "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind",
           "supersedesRevisionId", "title", "summary", "narrativeJson", "uncertaintyJson",
           "counterEvidenceJson", "occurredAt", "knownAt"
         ) VALUES ($1, $2, 3, $3, 'CORRECTED', $4, '跨事件', '不得通过', '{}'::jsonb,
           '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        key("cross-event-revision"),
        eventId,
        key("cross-event-revision-key"),
        otherRevisionId,
      ),
    ).rejects.toThrow(/same research event/);
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "ResearchEventRevision" (
           "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind", "title",
           "summary", "narrativeJson", "uncertaintyJson", "counterEvidenceJson",
           "occurredAt", "knownAt"
         ) VALUES ($1, $2, 3, $3, 'RETRACTED', '撤回', '必须有前序', '{}'::jsonb,
           '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        key("missing-predecessor-revision"),
        eventId,
        key("missing-predecessor-revision-key"),
      ),
    ).rejects.toThrow(/requires a predecessor/);

    const retractedRevisionId = key("retracted-revision");
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchEventRevision" (
         "id", "eventId", "revisionNo", "revisionDedupKey", "revisionKind",
         "supersedesRevisionId", "title", "summary", "narrativeJson", "uncertaintyJson",
         "counterEvidenceJson", "occurredAt", "knownAt"
       ) VALUES ($1, $2, 3, $3, 'RETRACTED', $4, '撤回', '撤回摘要', '{}'::jsonb,
         '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      retractedRevisionId,
      eventId,
      key("retracted-revision-key"),
      correctionRevisionId,
    );
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchEvent" SET "currentRevisionId" = $1 WHERE "id" = $2`,
        retractedRevisionId,
        eventId,
      ),
    ).rejects.toThrow(/requires a retracted research event/);
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "ResearchEvent" SET "status" = 'RETRACTED', "currentRevisionId" = $1 WHERE "id" = $2`,
        retractedRevisionId,
        eventId,
      ),
    ).resolves.toBe(1);
    const revisions = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "ResearchEventRevision" WHERE "eventId" = $1`,
      eventId,
    );
    expect(Number(revisions[0]?.count)).toBe(3);
  });
});

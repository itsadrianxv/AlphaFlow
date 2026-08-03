-- F01: 研究信息权威关系模型。项目尚未部署，旧首页 mock 语义直接删除。
DROP TABLE IF EXISTS "HomePageSnapshot" CASCADE;
DROP TABLE IF EXISTS "HomePageGenerationTask" CASCADE;
DROP TYPE IF EXISTS "HomePageGenerationTaskStatus";
DROP TYPE IF EXISTS "HomePageSnapshotScope";

CREATE SEQUENCE "HomepageDataManifest_activationSequence_seq";

CREATE TABLE "SourceAssertion" (
    "id" TEXT NOT NULL,
    "assertionKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "observationIdentityKey" TEXT NOT NULL,
    "rawRecordJson" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "requestParamsHash" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL,
    "upstreamAsOf" TIMESTAMPTZ(3),
    "sourcePublishedAt" TIMESTAMPTZ(3),
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceAssertion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SourceAssertion_hashes_check" CHECK (
        "contentHash" LIKE 'sha256:%' AND "requestParamsHash" LIKE 'sha256:%'
    )
);

CREATE TABLE "DataObservation" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "metricCatalogId" TEXT NOT NULL,
    "dimensionsJson" JSONB NOT NULL DEFAULT '{}',
    "observationKind" TEXT NOT NULL,
    "observationDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataObservation_period_check" CHECK (
        ("observationKind" = 'INSTANT' AND "observationDate" IS NOT NULL AND "periodStart" IS NULL AND "periodEnd" IS NULL)
        OR
        ("observationKind" = 'PERIOD' AND "observationDate" IS NULL AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL AND "periodStart" <= "periodEnd")
    )
);

CREATE TABLE "DataObservationRevision" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "revisionDedupKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "valueType" TEXT NOT NULL,
    "valueText" TEXT,
    "valueJson" JSONB,
    "unit" TEXT,
    "precision" INTEGER,
    "missingReason" TEXT,
    "qualityStatus" TEXT NOT NULL,
    "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "valueHash" TEXT NOT NULL,
    "normalizationRulesVersion" TEXT NOT NULL,
    "supersedesRevisionId" TEXT,
    "correctionOfRevisionId" TEXT,
    "explicitCorrection" BOOLEAN NOT NULL DEFAULT FALSE,
    "upstreamAsOf" TIMESTAMPTZ(3),
    "sourcePublishedAt" TIMESTAMPTZ(3),
    "normalizedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataObservationRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DataObservationRevision_revision_no_check" CHECK ("revisionNo" > 0),
    CONSTRAINT "DataObservationRevision_quality_check" CHECK ("qualityStatus" IN ('NORMAL', 'DEGRADED', 'ISOLATED')),
    CONSTRAINT "DataObservationRevision_value_check" CHECK (
        ("missingReason" IS NOT NULL AND "valueText" IS NULL AND "valueJson" IS NULL)
        OR
        ("missingReason" IS NULL AND num_nonnulls("valueText", "valueJson") = 1)
    ),
    CONSTRAINT "DataObservationRevision_hash_check" CHECK ("valueHash" LIKE 'sha256:%'),
    CONSTRAINT "DataObservationRevision_no_self_supersede_check" CHECK (
        "supersedesRevisionId" IS NULL OR "supersedesRevisionId" <> "id"
    ),
    CONSTRAINT "DataObservationRevision_no_self_correction_check" CHECK (
        "correctionOfRevisionId" IS NULL OR "correctionOfRevisionId" <> "id"
    )
);

CREATE TABLE "DataObservationRevisionSource" (
    "revisionId" TEXT NOT NULL,
    "sourceAssertionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "authorityStrategyVersion" TEXT NOT NULL,
    "selectionReason" TEXT NOT NULL,
    "fallbackReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataObservationRevisionSource_pkey" PRIMARY KEY ("revisionId", "sourceAssertionId"),
    CONSTRAINT "DataObservationRevisionSource_role_check" CHECK ("role" IN ('SELECTED', 'CORROBORATING'))
);

CREATE TABLE "DataObservationRevisionInput" (
    "revisionId" TEXT NOT NULL,
    "inputRevisionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "parametersJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataObservationRevisionInput_pkey" PRIMARY KEY ("revisionId", "inputRevisionId"),
    CONSTRAINT "DataObservationRevisionInput_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "DataObservationRevisionInput_no_self_check" CHECK ("revisionId" <> "inputRevisionId")
);

CREATE TABLE "HomepageDataManifest" (
    "id" TEXT NOT NULL,
    "manifestKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "definitionVersion" TEXT NOT NULL,
    "targetContextKey" TEXT NOT NULL,
    "targetContextJson" JSONB NOT NULL,
    "requestNonce" TEXT,
    "activationSequence" BIGINT NOT NULL DEFAULT nextval('"HomepageDataManifest_activationSequence_seq"'),
    "userId" TEXT,
    "baseManifestId" TEXT,
    "frozenPreferenceContractVersion" TEXT,
    "frozenPreferenceJson" JSONB,
    "gateStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageDataManifest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageDataManifest_scope_check" CHECK ("scope" IN ('BASELINE', 'PERSONALIZED')),
    CONSTRAINT "HomepageDataManifest_gate_status_check" CHECK ("gateStatus" IN ('PENDING', 'BLOCKED', 'READY', 'READY_WITH_LIMITATION')),
    CONSTRAINT "HomepageDataManifest_scope_relation_check" CHECK (
        ("scope" = 'BASELINE' AND "userId" IS NULL AND "baseManifestId" IS NULL AND "frozenPreferenceContractVersion" IS NULL AND "frozenPreferenceJson" IS NULL)
        OR
        ("scope" = 'PERSONALIZED' AND "userId" IS NOT NULL AND "baseManifestId" IS NOT NULL AND "frozenPreferenceContractVersion" IS NOT NULL AND "frozenPreferenceJson" IS NOT NULL)
    )
);

ALTER SEQUENCE "HomepageDataManifest_activationSequence_seq" OWNED BY "HomepageDataManifest"."activationSequence";

CREATE TABLE "HomepageDataManifestItem" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "factScopeKey" TEXT NOT NULL,
    "factScopeJson" JSONB NOT NULL,
    "requirementVersion" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "emptyPolicy" TEXT NOT NULL,
    "targetDataCutoffKey" TEXT NOT NULL,
    "targetDataCutoffJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageDataManifestItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageDataManifestItem_empty_policy_check" CHECK ("emptyPolicy" IN ('ALLOW_EMPTY', 'REQUIRE_NON_EMPTY'))
);

CREATE TABLE "HomepageDataManifestItemAttempt" (
    "id" TEXT NOT NULL,
    "manifestItemId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerContractVersion" TEXT NOT NULL,
    "normalizationRulesVersion" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultStatus" TEXT,
    "resultEnvelopeJson" JSONB,
    "resultHash" TEXT,
    "errorClass" TEXT,
    "retryability" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3),
    "eventPublishedAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageDataManifestItemAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageDataManifestItemAttempt_attempt_no_check" CHECK ("attemptNo" > 0),
    CONSTRAINT "HomepageDataManifestItemAttempt_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT "HomepageDataManifestItemAttempt_result_status_check" CHECK ("resultStatus" IS NULL OR "resultStatus" IN ('success', 'degraded', 'empty', 'error')),
    CONSTRAINT "HomepageDataManifestItemAttempt_retryability_check" CHECK ("retryability" IS NULL OR "retryability" IN ('RETRYABLE', 'NON_RETRYABLE')),
    CONSTRAINT "HomepageDataManifestItemAttempt_request_hash_check" CHECK ("requestFingerprint" LIKE 'sha256:%'),
    CONSTRAINT "HomepageDataManifestItemAttempt_result_hash_check" CHECK ("resultHash" IS NULL OR "resultHash" LIKE 'sha256:%')
);

CREATE TABLE "HomepageDataManifestItemSettlement" (
    "id" TEXT NOT NULL,
    "manifestItemId" TEXT NOT NULL,
    "settledAttemptId" TEXT NOT NULL,
    "settledFencingToken" BIGINT NOT NULL,
    "selectedRevisionId" TEXT,
    "settlementStatus" TEXT NOT NULL,
    "providerResultStatus" TEXT NOT NULL,
    "requestedScopeJson" JSONB NOT NULL,
    "coveredScopeJson" JSONB NOT NULL,
    "missingScopeJson" JSONB NOT NULL,
    "targetDataCutoffKey" TEXT NOT NULL,
    "targetDataCutoffJson" JSONB NOT NULL,
    "actualDataCutoffKey" TEXT NOT NULL,
    "actualDataCutoffJson" JSONB NOT NULL,
    "qualityStatus" TEXT NOT NULL,
    "qualityFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "limitations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "errorClass" TEXT,
    "retryability" TEXT,
    "settledAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageDataManifestItemSettlement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageDataManifestItemSettlement_status_check" CHECK ("settlementStatus" IN ('READY', 'DEGRADED', 'EMPTY', 'FAILED')),
    CONSTRAINT "HomepageDataManifestItemSettlement_provider_status_check" CHECK ("providerResultStatus" IN ('success', 'degraded', 'empty', 'error')),
    CONSTRAINT "HomepageDataManifestItemSettlement_quality_check" CHECK ("qualityStatus" IN ('NORMAL', 'DEGRADED', 'ISOLATED')),
    CONSTRAINT "HomepageDataManifestItemSettlement_retryability_check" CHECK ("retryability" IS NULL OR "retryability" IN ('RETRYABLE', 'NON_RETRYABLE')),
    CONSTRAINT "HomepageDataManifestItemSettlement_revision_check" CHECK (
        ("settlementStatus" IN ('READY', 'DEGRADED') AND "selectedRevisionId" IS NOT NULL)
        OR
        ("settlementStatus" IN ('EMPTY', 'FAILED') AND "selectedRevisionId" IS NULL)
    ),
    CONSTRAINT "HomepageDataManifestItemSettlement_error_check" CHECK (
        ("settlementStatus" = 'FAILED' AND "errorClass" IS NOT NULL AND "retryability" IS NOT NULL)
        OR
        ("settlementStatus" <> 'FAILED')
    )
);

CREATE TABLE "HomepageDataManifestItemSettlementRevision" (
    "settlementId" TEXT NOT NULL,
    "observationRevisionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageDataManifestItemSettlementRevision_pkey" PRIMARY KEY ("settlementId", "observationRevisionId"),
    CONSTRAINT "HomepageDataManifestItemSettlementRevision_ordinal_check" CHECK ("ordinal" >= 0)
);

CREATE TABLE "HomepageGenerationTask" (
    "id" TEXT NOT NULL,
    "generationKey" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "activationSequence" BIGINT NOT NULL,
    "generationInputContractVersion" TEXT NOT NULL,
    "generatorDefinitionVersion" TEXT NOT NULL,
    "payloadSchemaVersion" TEXT NOT NULL,
    "promotionMode" TEXT NOT NULL,
    "schedulingTier" TEXT NOT NULL,
    "resourcePoolKey" TEXT NOT NULL,
    "fairnessKey" TEXT NOT NULL,
    "targetCompletionAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "workerId" TEXT,
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "nextAttemptAt" TIMESTAMPTZ(3),
    "eventPublishedAt" TIMESTAMPTZ(3),
    "inputHash" TEXT,
    "errorCode" TEXT,
    "errorDetailsJson" JSONB,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageGenerationTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageGenerationTask_promotion_check" CHECK ("promotionMode" IN ('PROMOTABLE', 'HISTORICAL_ONLY')),
    CONSTRAINT "HomepageGenerationTask_tier_check" CHECK ("schedulingTier" IN ('INTERACTIVE', 'TIME_CRITICAL', 'BACKGROUND')),
    CONSTRAINT "HomepageGenerationTask_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT "HomepageGenerationTask_input_hash_check" CHECK ("inputHash" IS NULL OR "inputHash" LIKE 'sha256:%')
);

CREATE TABLE "HomepageSnapshot" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "generationTaskId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "activationSequence" BIGINT NOT NULL,
    "generationInputContractVersion" TEXT NOT NULL,
    "generatorDefinitionVersion" TEXT NOT NULL,
    "payloadSchemaVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "dataCoverageJson" JSONB NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageSnapshot_scope_check" CHECK ("scope" IN ('BASELINE', 'PERSONALIZED')),
    CONSTRAINT "HomepageSnapshot_user_scope_check" CHECK (
        ("scope" = 'BASELINE' AND "userId" IS NULL) OR ("scope" = 'PERSONALIZED' AND "userId" IS NOT NULL)
    ),
    CONSTRAINT "HomepageSnapshot_hashes_check" CHECK ("inputHash" LIKE 'sha256:%' AND "payloadHash" LIKE 'sha256:%')
);

CREATE TABLE "HomepageCurrentSnapshotProjection" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "snapshotId" TEXT NOT NULL,
    "activationSequence" BIGINT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HomepageCurrentSnapshotProjection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HomepageCurrentSnapshotProjection_scope_check" CHECK ("scope" IN ('BASELINE', 'PERSONALIZED')),
    CONSTRAINT "HomepageCurrentSnapshotProjection_user_scope_check" CHECK (
        ("scope" = 'BASELINE' AND "userId" IS NULL) OR ("scope" = 'PERSONALIZED' AND "userId" IS NOT NULL)
    )
);

CREATE TABLE "ResearchCandidateMaterial" (
    "id" TEXT NOT NULL,
    "materialKey" TEXT NOT NULL,
    "sourceItemKey" TEXT,
    "normalizedUrl" TEXT,
    "contentHash" TEXT NOT NULL,
    "sourceAssertionId" TEXT,
    "rawContentJson" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchCandidateMaterial_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchCandidateMaterial_identity_check" CHECK (
        num_nonnulls("sourceItemKey", "normalizedUrl") >= 1 OR "sourceAssertionId" IS NOT NULL
    ),
    CONSTRAINT "ResearchCandidateMaterial_hash_check" CHECK ("contentHash" LIKE 'sha256:%')
);

CREATE TABLE "ResearchEventCandidate" (
    "id" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "clusterKey" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "currentDecisionId" TEXT,
    "evidenceFrozenAt" TIMESTAMPTZ(3),
    "observationWindowEndsAt" TIMESTAMPTZ(3),
    "nextCheckAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventCandidate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventCandidate_status_check" CHECK ("status" IN ('OPEN', 'DEFERRED', 'PROMOTED', 'REJECTED', 'DEFERRED_ENDED', 'TECHNICAL_HOLD'))
);

CREATE TABLE "ResearchEventCandidateDecision" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "decisionNo" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "decisionJson" JSONB NOT NULL,
    "evidenceFrozenAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventCandidateDecision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventCandidateDecision_no_check" CHECK ("decisionNo" > 0),
    CONSTRAINT "ResearchEventCandidateDecision_outcome_check" CHECK ("outcome" IN ('PROMOTE', 'DEFER', 'REJECT', 'TECHNICAL_HOLD')),
    CONSTRAINT "ResearchEventCandidateDecision_hash_check" CHECK ("inputHash" LIKE 'sha256:%')
);

CREATE TABLE "ResearchEventCandidateEvidence" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "materialId" TEXT,
    "sourceAssertionId" TEXT,
    "observationRevisionId" TEXT,
    "ordinal" INTEGER NOT NULL,
    "evidenceRole" TEXT NOT NULL,
    "sourceIdentityStatus" TEXT NOT NULL,
    "proofQualification" TEXT NOT NULL,
    "independenceKey" TEXT NOT NULL,
    "citationJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventCandidateEvidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventCandidateEvidence_one_source_check" CHECK (
        num_nonnulls("materialId", "sourceAssertionId", "observationRevisionId") = 1
    ),
    CONSTRAINT "ResearchEventCandidateEvidence_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "ResearchEventCandidateEvidence_proof_check" CHECK ("proofQualification" IN ('QUALIFIED', 'CORROBORATING_ONLY', 'NOT_QUALIFIED'))
);

CREATE TABLE "ResearchEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEvent_status_check" CHECK ("status" IN ('ACTIVE', 'RETRACTED'))
);

CREATE TABLE "ResearchEventRevision" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sourceCandidateId" TEXT,
    "revisionNo" INTEGER NOT NULL,
    "revisionDedupKey" TEXT NOT NULL,
    "revisionKind" TEXT NOT NULL,
    "supersedesRevisionId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "narrativeJson" JSONB NOT NULL,
    "uncertaintyJson" JSONB NOT NULL,
    "counterEvidenceJson" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "knownAt" TIMESTAMPTZ(3) NOT NULL,
    "effectiveUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventRevision_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventRevision_no_check" CHECK ("revisionNo" > 0),
    CONSTRAINT "ResearchEventRevision_kind_check" CHECK ("revisionKind" IN ('CONFIRMED', 'CORRECTED', 'REVERIFIED', 'RETRACTED')),
    CONSTRAINT "ResearchEventRevision_no_self_check" CHECK ("supersedesRevisionId" IS NULL OR "supersedesRevisionId" <> "id")
);

CREATE TABLE "ResearchEventClaim" (
    "id" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "claimType" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "isInference" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventClaim_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventClaim_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "ResearchEventClaim_type_check" CHECK ("claimType" IN ('FACT', 'RESEARCH_IMPLICATION'))
);

CREATE TABLE "ResearchEventClaimCitation" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "candidateEvidenceId" TEXT,
    "sourceAssertionId" TEXT,
    "observationRevisionId" TEXT,
    "relation" TEXT NOT NULL,
    "sourceIdentityStatus" TEXT NOT NULL,
    "proofQualification" TEXT NOT NULL,
    "citationJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventClaimCitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventClaimCitation_one_source_check" CHECK (
        num_nonnulls("candidateEvidenceId", "sourceAssertionId", "observationRevisionId") = 1
    ),
    CONSTRAINT "ResearchEventClaimCitation_relation_check" CHECK ("relation" IN ('SUPPORTS', 'CONTRADICTS')),
    CONSTRAINT "ResearchEventClaimCitation_proof_check" CHECK ("proofQualification" IN ('QUALIFIED', 'CORROBORATING_ONLY', 'NOT_QUALIFIED'))
);

CREATE TABLE "ResearchEventImpact" (
    "id" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "impactType" TEXT NOT NULL,
    "materiality" TEXT NOT NULL,
    "pathJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventImpact_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventImpact_materiality_check" CHECK ("materiality" IN ('DIRECT', 'INDIRECT'))
);

CREATE TABLE "ResearchPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "urgentAlertsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "briefingsEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "externalCopiesEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "lastCommandId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchPreferenceItem" (
    "id" TEXT NOT NULL,
    "preferenceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'REGULAR',
    "createdByCommandId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMPTZ(3),
    CONSTRAINT "ResearchPreferenceItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchPreferenceItem_target_check" CHECK ("targetType" IN ('COMPANY', 'INDUSTRY', 'THEME', 'RESEARCH_EVENT', 'RESEARCH_HYPOTHESIS')),
    CONSTRAINT "ResearchPreferenceItem_level_check" CHECK ("level" IN ('REGULAR', 'FOCUS'))
);

CREATE TABLE "ResearchPreferenceSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "contractVersion" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "urgentAlertsEnabled" BOOLEAN NOT NULL,
    "briefingsEnabled" BOOLEAN NOT NULL,
    "externalCopiesEnabled" BOOLEAN NOT NULL,
    "normalizedItemsJson" JSONB,
    "contentHash" TEXT NOT NULL,
    "frozenAt" TIMESTAMPTZ(3) NOT NULL,
    "personalDataDeletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchPreferenceSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchPreferenceSnapshot_hash_check" CHECK ("contentHash" LIKE 'sha256:%')
);

CREATE TABLE "ResearchPreferenceSnapshotItem" (
    "snapshotId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchPreferenceSnapshotItem_pkey" PRIMARY KEY ("snapshotId", "ordinal"),
    CONSTRAINT "ResearchPreferenceSnapshotItem_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "ResearchPreferenceSnapshotItem_level_check" CHECK ("level" IN ('REGULAR', 'FOCUS'))
);

CREATE TABLE "ResearchEventGlobalAssessment" (
    "id" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "importance" SMALLINT,
    "confidence" SMALLINT,
    "informationNovelty" SMALLINT,
    "dimensionsJson" JSONB NOT NULL,
    "inputSnapshotJson" JSONB NOT NULL,
    "usageJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventGlobalAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventGlobalAssessment_scores_check" CHECK (
        ("importance" IS NULL OR "importance" BETWEEN 0 AND 4)
        AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 4)
        AND ("informationNovelty" IS NULL OR "informationNovelty" BETWEEN 0 AND 4)
    ),
    CONSTRAINT "ResearchEventGlobalAssessment_hash_check" CHECK ("inputHash" LIKE 'sha256:%')
);

CREATE TABLE "ResearchEventRelevanceAssessment" (
    "id" TEXT NOT NULL,
    "eventRevisionId" TEXT NOT NULL,
    "userId" TEXT,
    "preferenceSnapshotId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "relevance" SMALLINT,
    "directFocusMatch" BOOLEAN NOT NULL DEFAULT FALSE,
    "matchedPreferencesJson" JSONB,
    "dimensionJson" JSONB,
    "inputSnapshotJson" JSONB,
    "usageJson" JSONB NOT NULL,
    "personalDataDeletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchEventRelevanceAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchEventRelevanceAssessment_score_check" CHECK ("relevance" IS NULL OR "relevance" BETWEEN 0 AND 4),
    CONSTRAINT "ResearchEventRelevanceAssessment_hash_check" CHECK ("inputHash" LIKE 'sha256:%')
);

CREATE TABLE "ResearchInboxEntry" (
    "id" TEXT NOT NULL,
    "distributionKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventRevisionId" TEXT,
    "candidateId" TEXT,
    "briefingTaskId" TEXT,
    "globalAssessmentId" TEXT,
    "relevanceAssessmentId" TEXT,
    "preferenceSnapshotId" TEXT,
    "highestChannel" TEXT NOT NULL,
    "entryKind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "bodyJson" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UNREAD',
    "personalizationInputDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
    "openedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchInboxEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchInboxEntry_subject_check" CHECK (
        num_nonnulls("eventRevisionId", "candidateId", "briefingTaskId") = 1
        AND (("entryKind" = 'BRIEFING' AND "briefingTaskId" IS NOT NULL) OR ("entryKind" <> 'BRIEFING' AND "briefingTaskId" IS NULL))
    ),
    CONSTRAINT "ResearchInboxEntry_channel_check" CHECK ("highestChannel" IN ('IN_APP', 'BRIEFING', 'URGENT_ALERT')),
    CONSTRAINT "ResearchInboxEntry_kind_check" CHECK ("entryKind" IN ('EVENT', 'CANDIDATE_PENDING_VERIFICATION', 'CORRECTION', 'RETRACTION', 'BRIEFING')),
    CONSTRAINT "ResearchInboxEntry_state_check" CHECK ("state" IN ('UNREAD', 'READ', 'LATER', 'ARCHIVED'))
);

CREATE TABLE "ResearchInboxEntryHistory" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchInboxEntryHistory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchInboxEntryHistory_sequence_check" CHECK ("sequence" > 0),
    CONSTRAINT "ResearchInboxEntryHistory_to_state_check" CHECK ("toState" IN ('UNREAD', 'READ', 'LATER', 'ARCHIVED')),
    CONSTRAINT "ResearchInboxEntryHistory_from_state_check" CHECK ("fromState" IS NULL OR "fromState" IN ('UNREAD', 'READ', 'LATER', 'ARCHIVED'))
);

CREATE TABLE "ResearchInboxFeedback" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchInboxFeedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchInboxFeedback_value_check" CHECK ("value" IN ('USEFUL', 'NOISE'))
);

CREATE TABLE "ResearchResourcePool" (
    "id" TEXT NOT NULL,
    "poolKey" TEXT NOT NULL,
    "resourceKind" TEXT NOT NULL,
    "hardConcurrency" INTEGER NOT NULL,
    "currentConcurrency" INTEGER NOT NULL DEFAULT 1,
    "controlVersion" BIGINT NOT NULL DEFAULT 0,
    "lastHealthyAt" TIMESTAMPTZ(3),
    "cooldownUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchResourcePool_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchResourcePool_capacity_check" CHECK (
        "hardConcurrency" > 0 AND "currentConcurrency" > 0 AND "currentConcurrency" <= "hardConcurrency"
    )
);

CREATE TABLE "ResearchTask" (
    "id" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "inputContractVersion" TEXT NOT NULL,
    "inputJson" JSONB NOT NULL,
    "schedulingTier" TEXT NOT NULL,
    "resourcePoolId" TEXT NOT NULL,
    "fairnessKey" TEXT NOT NULL,
    "userId" TEXT,
    "manifestId" TEXT,
    "eventCandidateId" TEXT,
    "eventRevisionId" TEXT,
    "preferenceSnapshotId" TEXT,
    "parentTaskId" TEXT,
    "targetCompletionAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "retryDeadline" TIMESTAMPTZ(3) NOT NULL,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "workerId" TEXT,
    "fencingToken" BIGINT NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "resultContractVersion" TEXT,
    "resultHash" TEXT,
    "resultJson" JSONB,
    "errorClass" TEXT,
    "retryability" TEXT,
    "terminalReason" TEXT,
    "oldestBacklogAgeMs" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchTask_tier_check" CHECK ("schedulingTier" IN ('INTERACTIVE', 'TIME_CRITICAL', 'BACKGROUND')),
    CONSTRAINT "ResearchTask_status_check" CHECK ("status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED', 'MERGED')),
    CONSTRAINT "ResearchTask_retryability_check" CHECK ("retryability" IS NULL OR "retryability" IN ('RETRYABLE', 'NON_RETRYABLE')),
    CONSTRAINT "ResearchTask_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"),
    CONSTRAINT "ResearchTask_hashes_check" CHECK (
        "inputHash" LIKE 'sha256:%' AND ("resultHash" IS NULL OR "resultHash" LIKE 'sha256:%')
    )
);

CREATE TABLE "ResearchResourcePermit" (
    "id" TEXT NOT NULL,
    "resourcePoolId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "permitKey" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "fencingToken" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "acquiredAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "releasedAt" TIMESTAMPTZ(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchResourcePermit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchResourcePermit_status_check" CHECK ("status" IN ('ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED')),
    CONSTRAINT "ResearchResourcePermit_lease_check" CHECK ("leaseExpiresAt" > "acquiredAt"),
    CONSTRAINT "ResearchResourcePermit_release_check" CHECK (
        ("status" = 'ACTIVE' AND "releasedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "releasedAt" IS NOT NULL)
    )
);

CREATE TABLE "ResearchCircuitBreaker" (
    "id" TEXT NOT NULL,
    "resourcePoolId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CLOSED',
    "version" BIGINT NOT NULL DEFAULT 0,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "windowAttempts" INTEGER NOT NULL DEFAULT 0,
    "windowFailures" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "retryAfter" TIMESTAMPTZ(3),
    "halfOpenProbeTaskId" TEXT,
    "blockedReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchCircuitBreaker_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchCircuitBreaker_state_check" CHECK ("state" IN ('CLOSED', 'OPEN', 'HALF_OPEN', 'CONFIG_BLOCKED')),
    CONSTRAINT "ResearchCircuitBreaker_counts_check" CHECK (
        "consecutiveFailures" >= 0 AND "windowAttempts" >= 0 AND "windowFailures" >= 0 AND "windowFailures" <= "windowAttempts" AND "openCount" >= 0
    )
);

CREATE TABLE "ResearchAuditRecord" (
    "id" TEXT NOT NULL,
    "auditKey" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "taskId" TEXT,
    "manifestId" TEXT,
    "eventRevisionId" TEXT,
    "preferenceSnapshotId" TEXT,
    "inputContractVersion" TEXT,
    "inputHash" TEXT,
    "resultContractVersion" TEXT,
    "resultHash" TEXT,
    "outcome" TEXT NOT NULL,
    "detailsJson" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchAuditRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResearchAuditRecord_hashes_check" CHECK (
        ("inputHash" IS NULL OR "inputHash" LIKE 'sha256:%') AND ("resultHash" IS NULL OR "resultHash" LIKE 'sha256:%')
    )
);

-- 幂等键、历史序列、运行领取和读取索引。
CREATE UNIQUE INDEX "SourceAssertion_assertionKey_key" ON "SourceAssertion"("assertionKey");
CREATE INDEX "SourceAssertion_source_dataset_record_idx" ON "SourceAssertion"("sourceKey", "datasetKey", "sourceRecordKey");
CREATE INDEX "SourceAssertion_observationIdentityKey_idx" ON "SourceAssertion"("observationIdentityKey");
CREATE UNIQUE INDEX "DataObservation_identityKey_key" ON "DataObservation"("identityKey");
CREATE INDEX "DataObservation_subject_metric_idx" ON "DataObservation"("subjectType", "subjectKey", "metricCatalogId");
CREATE UNIQUE INDEX "DataObservationRevision_observationId_revisionNo_key" ON "DataObservationRevision"("observationId", "revisionNo");
CREATE UNIQUE INDEX "DataObservationRevision_revisionDedupKey_key" ON "DataObservationRevision"("revisionDedupKey");
CREATE INDEX "DataObservationRevision_observationId_normalizedAt_idx" ON "DataObservationRevision"("observationId", "normalizedAt");
CREATE UNIQUE INDEX "DataObservationRevisionSource_selected_key" ON "DataObservationRevisionSource"("revisionId") WHERE "role" = 'SELECTED';
CREATE UNIQUE INDEX "DataObservationRevisionInput_revisionId_ordinal_key" ON "DataObservationRevisionInput"("revisionId", "ordinal");
CREATE INDEX "DataObservationRevisionInput_inputRevisionId_idx" ON "DataObservationRevisionInput"("inputRevisionId");
CREATE UNIQUE INDEX "HomepageDataManifest_manifestKey_key" ON "HomepageDataManifest"("manifestKey");
CREATE UNIQUE INDEX "HomepageDataManifest_activationSequence_key" ON "HomepageDataManifest"("activationSequence");
CREATE INDEX "HomepageDataManifest_scope_gateStatus_createdAt_idx" ON "HomepageDataManifest"("scope", "gateStatus", "createdAt");
CREATE INDEX "HomepageDataManifest_userId_gateStatus_createdAt_idx" ON "HomepageDataManifest"("userId", "gateStatus", "createdAt");
CREATE UNIQUE INDEX "HomepageDataManifestItem_manifestId_itemKey_key" ON "HomepageDataManifestItem"("manifestId", "itemKey");
CREATE INDEX "HomepageDataManifestItem_manifestId_required_idx" ON "HomepageDataManifestItem"("manifestId", "required");
CREATE UNIQUE INDEX "HomepageDataManifestItemAttempt_manifestItemId_attemptNo_key" ON "HomepageDataManifestItemAttempt"("manifestItemId", "attemptNo");
CREATE UNIQUE INDEX "HomepageDataManifestItemAttempt_idempotencyKey_key" ON "HomepageDataManifestItemAttempt"("idempotencyKey");
CREATE INDEX "HomepageDataManifestItemAttempt_status_nextAttemptAt_idx" ON "HomepageDataManifestItemAttempt"("status", "nextAttemptAt");
CREATE INDEX "HomepageDataManifestItemAttempt_status_leaseExpiresAt_idx" ON "HomepageDataManifestItemAttempt"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "HomepageDataManifestItemSettlement_manifestItemId_key" ON "HomepageDataManifestItemSettlement"("manifestItemId");
CREATE UNIQUE INDEX "HomepageDataManifestItemSettlement_settledAttemptId_key" ON "HomepageDataManifestItemSettlement"("settledAttemptId");
CREATE UNIQUE INDEX "HomepageDataManifestItemSettlementRevision_settlementId_ordinal_key" ON "HomepageDataManifestItemSettlementRevision"("settlementId", "ordinal");
CREATE INDEX "HomepageDataManifestItemSettlementRevision_observationRevisionId_idx" ON "HomepageDataManifestItemSettlementRevision"("observationRevisionId");
CREATE UNIQUE INDEX "HomepageGenerationTask_generationKey_key" ON "HomepageGenerationTask"("generationKey");
CREATE UNIQUE INDEX "HomepageGenerationTask_manifestId_key" ON "HomepageGenerationTask"("manifestId");
CREATE INDEX "HomepageGenerationTask_status_nextAttemptAt_idx" ON "HomepageGenerationTask"("status", "nextAttemptAt");
CREATE INDEX "HomepageGenerationTask_status_leaseExpiresAt_idx" ON "HomepageGenerationTask"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "HomepageSnapshot_generationTaskId_key" ON "HomepageSnapshot"("generationTaskId");
CREATE INDEX "HomepageSnapshot_scope_activationSequence_idx" ON "HomepageSnapshot"("scope", "activationSequence");
CREATE INDEX "HomepageSnapshot_userId_activationSequence_idx" ON "HomepageSnapshot"("userId", "activationSequence");
CREATE UNIQUE INDEX "HomepageCurrentSnapshotProjection_baseline_key" ON "HomepageCurrentSnapshotProjection"("scope") WHERE "scope" = 'BASELINE';
CREATE UNIQUE INDEX "HomepageCurrentSnapshotProjection_user_key" ON "HomepageCurrentSnapshotProjection"("userId") WHERE "scope" = 'PERSONALIZED';
CREATE UNIQUE INDEX "ResearchCandidateMaterial_materialKey_key" ON "ResearchCandidateMaterial"("materialKey");
CREATE UNIQUE INDEX "ResearchEventCandidate_candidateKey_key" ON "ResearchEventCandidate"("candidateKey");
CREATE INDEX "ResearchEventCandidate_status_nextCheckAt_idx" ON "ResearchEventCandidate"("status", "nextCheckAt");
CREATE UNIQUE INDEX "ResearchEventCandidateDecision_candidateId_decisionNo_key" ON "ResearchEventCandidateDecision"("candidateId", "decisionNo");
CREATE UNIQUE INDEX "ResearchEventCandidateDecision_inputHash_key" ON "ResearchEventCandidateDecision"("inputHash");
CREATE UNIQUE INDEX "ResearchEventCandidateEvidence_candidateId_ordinal_key" ON "ResearchEventCandidateEvidence"("candidateId", "ordinal");
CREATE UNIQUE INDEX "ResearchEventCandidateEvidence_candidateId_materialId_key" ON "ResearchEventCandidateEvidence"("candidateId", "materialId") WHERE "materialId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEventCandidateEvidence_candidateId_sourceAssertionId_key" ON "ResearchEventCandidateEvidence"("candidateId", "sourceAssertionId") WHERE "sourceAssertionId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEventCandidateEvidence_candidateId_observationRevisionId_key" ON "ResearchEventCandidateEvidence"("candidateId", "observationRevisionId") WHERE "observationRevisionId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEvent_eventKey_key" ON "ResearchEvent"("eventKey");
CREATE UNIQUE INDEX "ResearchEventRevision_eventId_revisionNo_key" ON "ResearchEventRevision"("eventId", "revisionNo");
CREATE UNIQUE INDEX "ResearchEventRevision_revisionDedupKey_key" ON "ResearchEventRevision"("revisionDedupKey");
CREATE UNIQUE INDEX "ResearchEventClaim_eventRevisionId_ordinal_key" ON "ResearchEventClaim"("eventRevisionId", "ordinal");
CREATE UNIQUE INDEX "ResearchEventClaimCitation_claimId_candidateEvidenceId_key" ON "ResearchEventClaimCitation"("claimId", "candidateEvidenceId") WHERE "candidateEvidenceId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEventClaimCitation_claimId_sourceAssertionId_key" ON "ResearchEventClaimCitation"("claimId", "sourceAssertionId") WHERE "sourceAssertionId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEventClaimCitation_claimId_observationRevisionId_key" ON "ResearchEventClaimCitation"("claimId", "observationRevisionId") WHERE "observationRevisionId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchEventImpact_revision_subject_key" ON "ResearchEventImpact"("eventRevisionId", "subjectType", "subjectKey", "impactType");
CREATE UNIQUE INDEX "ResearchPreference_userId_key" ON "ResearchPreference"("userId");
CREATE UNIQUE INDEX "ResearchPreference_lastCommandId_key" ON "ResearchPreference"("lastCommandId") WHERE "lastCommandId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchPreferenceItem_active_target_key" ON "ResearchPreferenceItem"("preferenceId", "targetType", "targetKey") WHERE "removedAt" IS NULL;
CREATE INDEX "ResearchPreferenceItem_preferenceId_removedAt_idx" ON "ResearchPreferenceItem"("preferenceId", "removedAt");
CREATE UNIQUE INDEX "ResearchPreferenceSnapshot_userId_contentHash_key" ON "ResearchPreferenceSnapshot"("userId", "contentHash");
CREATE UNIQUE INDEX "ResearchPreferenceSnapshotItem_identity_key" ON "ResearchPreferenceSnapshotItem"("snapshotId", "targetType", "targetKey");
CREATE UNIQUE INDEX "ResearchEventGlobalAssessment_eventRevisionId_key" ON "ResearchEventGlobalAssessment"("eventRevisionId");
CREATE UNIQUE INDEX "ResearchEventGlobalAssessment_inputHash_key" ON "ResearchEventGlobalAssessment"("inputHash");
CREATE UNIQUE INDEX "ResearchEventRelevanceAssessment_revision_user_key" ON "ResearchEventRelevanceAssessment"("eventRevisionId", "userId");
CREATE UNIQUE INDEX "ResearchEventRelevanceAssessment_inputHash_key" ON "ResearchEventRelevanceAssessment"("inputHash");
CREATE UNIQUE INDEX "ResearchInboxEntry_distributionKey_key" ON "ResearchInboxEntry"("distributionKey");
CREATE INDEX "ResearchInboxEntry_userId_state_createdAt_idx" ON "ResearchInboxEntry"("userId", "state", "createdAt");
CREATE INDEX "ResearchInboxEntry_eventRevisionId_idx" ON "ResearchInboxEntry"("eventRevisionId");
CREATE UNIQUE INDEX "ResearchInboxEntryHistory_entryId_sequence_key" ON "ResearchInboxEntryHistory"("entryId", "sequence");
CREATE UNIQUE INDEX "ResearchInboxEntryHistory_commandId_key" ON "ResearchInboxEntryHistory"("commandId");
CREATE UNIQUE INDEX "ResearchInboxFeedback_entryId_key" ON "ResearchInboxFeedback"("entryId");
CREATE UNIQUE INDEX "ResearchInboxFeedback_commandId_key" ON "ResearchInboxFeedback"("commandId");
CREATE UNIQUE INDEX "ResearchResourcePool_poolKey_key" ON "ResearchResourcePool"("poolKey");
CREATE UNIQUE INDEX "ResearchTask_idempotencyKey_key" ON "ResearchTask"("idempotencyKey");
CREATE INDEX "ResearchTask_claim_idx" ON "ResearchTask"("resourcePoolId", "status", "schedulingTier", "targetCompletionAt", "nextAttemptAt", "createdAt");
CREATE INDEX "ResearchTask_fairness_idx" ON "ResearchTask"("resourcePoolId", "schedulingTier", "fairnessKey", "createdAt");
CREATE INDEX "ResearchTask_lease_idx" ON "ResearchTask"("status", "leaseExpiresAt");
CREATE UNIQUE INDEX "ResearchResourcePermit_permitKey_key" ON "ResearchResourcePermit"("permitKey");
CREATE UNIQUE INDEX "ResearchResourcePermit_active_task_pool_key" ON "ResearchResourcePermit"("resourcePoolId", "taskId") WHERE "status" = 'ACTIVE';
CREATE INDEX "ResearchResourcePermit_pool_status_lease_idx" ON "ResearchResourcePermit"("resourcePoolId", "status", "leaseExpiresAt");
CREATE UNIQUE INDEX "ResearchCircuitBreaker_resourcePoolId_key" ON "ResearchCircuitBreaker"("resourcePoolId");
CREATE UNIQUE INDEX "ResearchCircuitBreaker_halfOpenProbeTaskId_key" ON "ResearchCircuitBreaker"("halfOpenProbeTaskId") WHERE "halfOpenProbeTaskId" IS NOT NULL;
CREATE UNIQUE INDEX "ResearchAuditRecord_auditKey_key" ON "ResearchAuditRecord"("auditKey");
CREATE INDEX "ResearchAuditRecord_entity_idx" ON "ResearchAuditRecord"("entityType", "entityId", "occurredAt");
CREATE INDEX "ResearchAuditRecord_taskId_idx" ON "ResearchAuditRecord"("taskId", "occurredAt");

-- 历史关系全部 RESTRICT；用户删除必须由明确隐私流程处理。
ALTER TABLE "DataObservationRevision" ADD CONSTRAINT "DataObservationRevision_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "DataObservation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevision" ADD CONSTRAINT "DataObservationRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevision" ADD CONSTRAINT "DataObservationRevision_correctionOfRevisionId_fkey" FOREIGN KEY ("correctionOfRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservation" ADD CONSTRAINT "DataObservation_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevisionSource" ADD CONSTRAINT "DataObservationRevisionSource_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevisionSource" ADD CONSTRAINT "DataObservationRevisionSource_sourceAssertionId_fkey" FOREIGN KEY ("sourceAssertionId") REFERENCES "SourceAssertion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevisionInput" ADD CONSTRAINT "DataObservationRevisionInput_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "DataObservationRevisionInput" ADD CONSTRAINT "DataObservationRevisionInput_inputRevisionId_fkey" FOREIGN KEY ("inputRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifest" ADD CONSTRAINT "HomepageDataManifest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifest" ADD CONSTRAINT "HomepageDataManifest_baseManifestId_fkey" FOREIGN KEY ("baseManifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItem" ADD CONSTRAINT "HomepageDataManifestItem_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemAttempt" ADD CONSTRAINT "HomepageDataManifestItemAttempt_manifestItemId_fkey" FOREIGN KEY ("manifestItemId") REFERENCES "HomepageDataManifestItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemSettlement" ADD CONSTRAINT "HomepageDataManifestItemSettlement_manifestItemId_fkey" FOREIGN KEY ("manifestItemId") REFERENCES "HomepageDataManifestItem"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemSettlement" ADD CONSTRAINT "HomepageDataManifestItemSettlement_settledAttemptId_fkey" FOREIGN KEY ("settledAttemptId") REFERENCES "HomepageDataManifestItemAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemSettlement" ADD CONSTRAINT "HomepageDataManifestItemSettlement_selectedRevisionId_fkey" FOREIGN KEY ("selectedRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemSettlementRevision" ADD CONSTRAINT "HomepageDataManifestItemSettlementRevision_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "HomepageDataManifestItemSettlement"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageDataManifestItemSettlementRevision" ADD CONSTRAINT "HDPSettlementRevision_observationRevision_fkey" FOREIGN KEY ("observationRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageGenerationTask" ADD CONSTRAINT "HomepageGenerationTask_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageSnapshot" ADD CONSTRAINT "HomepageSnapshot_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageSnapshot" ADD CONSTRAINT "HomepageSnapshot_generationTaskId_fkey" FOREIGN KEY ("generationTaskId") REFERENCES "HomepageGenerationTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageSnapshot" ADD CONSTRAINT "HomepageSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageCurrentSnapshotProjection" ADD CONSTRAINT "HomepageCurrentSnapshotProjection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "HomepageCurrentSnapshotProjection" ADD CONSTRAINT "HomepageCurrentSnapshotProjection_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "HomepageSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchCandidateMaterial" ADD CONSTRAINT "ResearchCandidateMaterial_sourceAssertionId_fkey" FOREIGN KEY ("sourceAssertionId") REFERENCES "SourceAssertion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidateEvidence" ADD CONSTRAINT "ResearchEventCandidateEvidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ResearchEventCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidateDecision" ADD CONSTRAINT "ResearchEventCandidateDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ResearchEventCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidate" ADD CONSTRAINT "ResearchEventCandidate_currentDecisionId_fkey" FOREIGN KEY ("currentDecisionId") REFERENCES "ResearchEventCandidateDecision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidateEvidence" ADD CONSTRAINT "ResearchEventCandidateEvidence_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ResearchCandidateMaterial"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidateEvidence" ADD CONSTRAINT "ResearchEventCandidateEvidence_sourceAssertionId_fkey" FOREIGN KEY ("sourceAssertionId") REFERENCES "SourceAssertion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventCandidateEvidence" ADD CONSTRAINT "ResearchEventCandidateEvidence_observationRevisionId_fkey" FOREIGN KEY ("observationRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRevision" ADD CONSTRAINT "ResearchEventRevision_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ResearchEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRevision" ADD CONSTRAINT "ResearchEventRevision_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "ResearchEventCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRevision" ADD CONSTRAINT "ResearchEventRevision_supersedesRevisionId_fkey" FOREIGN KEY ("supersedesRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEvent" ADD CONSTRAINT "ResearchEvent_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventClaim" ADD CONSTRAINT "ResearchEventClaim_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventClaimCitation" ADD CONSTRAINT "ResearchEventClaimCitation_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ResearchEventClaim"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventClaimCitation" ADD CONSTRAINT "ResearchEventClaimCitation_candidateEvidenceId_fkey" FOREIGN KEY ("candidateEvidenceId") REFERENCES "ResearchEventCandidateEvidence"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventClaimCitation" ADD CONSTRAINT "ResearchEventClaimCitation_sourceAssertionId_fkey" FOREIGN KEY ("sourceAssertionId") REFERENCES "SourceAssertion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventClaimCitation" ADD CONSTRAINT "ResearchEventClaimCitation_observationRevisionId_fkey" FOREIGN KEY ("observationRevisionId") REFERENCES "DataObservationRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventImpact" ADD CONSTRAINT "ResearchEventImpact_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchPreference" ADD CONSTRAINT "ResearchPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchPreferenceItem" ADD CONSTRAINT "ResearchPreferenceItem_preferenceId_fkey" FOREIGN KEY ("preferenceId") REFERENCES "ResearchPreference"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchPreferenceSnapshot" ADD CONSTRAINT "ResearchPreferenceSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "ResearchPreferenceSnapshotItem" ADD CONSTRAINT "ResearchPreferenceSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventGlobalAssessment" ADD CONSTRAINT "ResearchEventGlobalAssessment_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRelevanceAssessment" ADD CONSTRAINT "ResearchEventRelevanceAssessment_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRelevanceAssessment" ADD CONSTRAINT "ResearchEventRelevanceAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE "ResearchEventRelevanceAssessment" ADD CONSTRAINT "ResearchEventRelevanceAssessment_preferenceSnapshotId_fkey" FOREIGN KEY ("preferenceSnapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ResearchEventCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_globalAssessmentId_fkey" FOREIGN KEY ("globalAssessmentId") REFERENCES "ResearchEventGlobalAssessment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_relevanceAssessmentId_fkey" FOREIGN KEY ("relevanceAssessmentId") REFERENCES "ResearchEventRelevanceAssessment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_preferenceSnapshotId_fkey" FOREIGN KEY ("preferenceSnapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntryHistory" ADD CONSTRAINT "ResearchInboxEntryHistory_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ResearchInboxEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxFeedback" ADD CONSTRAINT "ResearchInboxFeedback_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ResearchInboxEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxFeedback" ADD CONSTRAINT "ResearchInboxFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_resourcePoolId_fkey" FOREIGN KEY ("resourcePoolId") REFERENCES "ResearchResourcePool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_eventCandidateId_fkey" FOREIGN KEY ("eventCandidateId") REFERENCES "ResearchEventCandidate"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_preferenceSnapshotId_fkey" FOREIGN KEY ("preferenceSnapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchTask" ADD CONSTRAINT "ResearchTask_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchInboxEntry" ADD CONSTRAINT "ResearchInboxEntry_briefingTaskId_fkey" FOREIGN KEY ("briefingTaskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchResourcePermit" ADD CONSTRAINT "ResearchResourcePermit_resourcePoolId_fkey" FOREIGN KEY ("resourcePoolId") REFERENCES "ResearchResourcePool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchResourcePermit" ADD CONSTRAINT "ResearchResourcePermit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchCircuitBreaker" ADD CONSTRAINT "ResearchCircuitBreaker_resourcePoolId_fkey" FOREIGN KEY ("resourcePoolId") REFERENCES "ResearchResourcePool"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchCircuitBreaker" ADD CONSTRAINT "ResearchCircuitBreaker_halfOpenProbeTaskId_fkey" FOREIGN KEY ("halfOpenProbeTaskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchAuditRecord" ADD CONSTRAINT "ResearchAuditRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchAuditRecord" ADD CONSTRAINT "ResearchAuditRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ResearchTask"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchAuditRecord" ADD CONSTRAINT "ResearchAuditRecord_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "HomepageDataManifest"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchAuditRecord" ADD CONSTRAINT "ResearchAuditRecord_eventRevisionId_fkey" FOREIGN KEY ("eventRevisionId") REFERENCES "ResearchEventRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ResearchAuditRecord" ADD CONSTRAINT "ResearchAuditRecord_preferenceSnapshotId_fkey" FOREIGN KEY ("preferenceSnapshotId") REFERENCES "ResearchPreferenceSnapshot"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 数据库级跨行关系校验。
CREATE OR REPLACE FUNCTION "validate_homepage_manifest_parent"() RETURNS TRIGGER AS $$
DECLARE
    parent_scope TEXT;
    parent_gate TEXT;
BEGIN
    IF NEW."scope" = 'PERSONALIZED' THEN
        SELECT "scope", "gateStatus" INTO parent_scope, parent_gate
        FROM "HomepageDataManifest"
        WHERE "id" = NEW."baseManifestId"
        FOR SHARE;

        IF parent_scope IS NULL THEN
            RAISE EXCEPTION 'personalized manifest requires an existing base manifest';
        END IF;
        IF parent_scope <> 'BASELINE' OR parent_gate NOT IN ('READY', 'READY_WITH_LIMITATION') THEN
            RAISE EXCEPTION 'personalized manifest base must be a ready baseline';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HomepageDataManifest_parent_guard"
BEFORE INSERT OR UPDATE OF "scope", "baseManifestId" ON "HomepageDataManifest"
FOR EACH ROW EXECUTE FUNCTION "validate_homepage_manifest_parent"();

CREATE OR REPLACE FUNCTION "validate_manifest_item_no_parent_override"() RETURNS TRIGGER AS $$
DECLARE
    parent_id TEXT;
BEGIN
    SELECT "baseManifestId" INTO parent_id FROM "HomepageDataManifest" WHERE "id" = NEW."manifestId" FOR SHARE;
    IF parent_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM "HomepageDataManifestItem"
        WHERE "manifestId" = parent_id AND "itemKey" = NEW."itemKey"
    ) THEN
        RAISE EXCEPTION 'personalized manifest item cannot override its baseline item';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HomepageDataManifestItem_parent_override_guard"
BEFORE INSERT OR UPDATE OF "manifestId", "itemKey" ON "HomepageDataManifestItem"
FOR EACH ROW EXECUTE FUNCTION "validate_manifest_item_no_parent_override"();

CREATE OR REPLACE FUNCTION "validate_manifest_item_settlement_attempt"() RETURNS TRIGGER AS $$
DECLARE
    attempt_item_id TEXT;
    attempt_token BIGINT;
    attempt_worker_id TEXT;
    attempt_lease_expires_at TIMESTAMPTZ(3);
    attempt_status TEXT;
BEGIN
    SELECT "manifestItemId", "fencingToken", "workerId", "leaseExpiresAt", "status"
    INTO attempt_item_id, attempt_token, attempt_worker_id, attempt_lease_expires_at, attempt_status
    FROM "HomepageDataManifestItemAttempt"
    WHERE "id" = NEW."settledAttemptId"
    FOR UPDATE;

    IF attempt_item_id IS NULL OR attempt_item_id <> NEW."manifestItemId" THEN
        RAISE EXCEPTION 'settled attempt must belong to the manifest item';
    END IF;
    IF attempt_token <> NEW."settledFencingToken"
       OR attempt_worker_id IS NULL
       OR attempt_status <> 'RUNNING'
       OR attempt_lease_expires_at IS NULL
       OR attempt_lease_expires_at <= NEW."settledAt" THEN
        RAISE EXCEPTION 'STALE_FENCING';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HomepageDataManifestItemSettlement_attempt_guard"
BEFORE INSERT ON "HomepageDataManifestItemSettlement"
FOR EACH ROW EXECUTE FUNCTION "validate_manifest_item_settlement_attempt"();

CREATE OR REPLACE FUNCTION "validate_observation_current_revision"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "DataObservationRevision"
        WHERE "id" = NEW."currentRevisionId" AND "observationId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'current revision must belong to the same observation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataObservation_current_revision_guard"
BEFORE INSERT OR UPDATE OF "currentRevisionId" ON "DataObservation"
FOR EACH ROW EXECUTE FUNCTION "validate_observation_current_revision"();

CREATE OR REPLACE FUNCTION "validate_event_current_revision"() RETURNS TRIGGER AS $$
DECLARE
    current_revision_kind TEXT;
BEGIN
    IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ResearchEventRevision"
        WHERE "id" = NEW."currentRevisionId" AND "eventId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'current revision must belong to the same research event';
    END IF;
    IF NEW."currentRevisionId" IS NOT NULL THEN
        SELECT "revisionKind" INTO current_revision_kind
        FROM "ResearchEventRevision"
        WHERE "id" = NEW."currentRevisionId";
        IF current_revision_kind = 'RETRACTED' AND NEW."status" <> 'RETRACTED' THEN
            RAISE EXCEPTION 'retracted current revision requires a retracted research event';
        END IF;
        IF NEW."status" = 'RETRACTED' AND current_revision_kind <> 'RETRACTED' THEN
            RAISE EXCEPTION 'retracted research event requires a retracted current revision';
        END IF;
    ELSIF NEW."status" = 'RETRACTED' THEN
        RAISE EXCEPTION 'retracted research event requires a current revision';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEvent_current_revision_guard"
BEFORE INSERT OR UPDATE OF "currentRevisionId" ON "ResearchEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_event_current_revision"();

CREATE OR REPLACE FUNCTION "validate_event_revision_chain"() RETURNS TRIGGER AS $$
DECLARE
    predecessor_event_id TEXT;
    predecessor_revision_no INTEGER;
    event_status TEXT;
BEGIN
    SELECT "status" INTO event_status
    FROM "ResearchEvent"
    WHERE "id" = NEW."eventId";

    IF event_status IS NULL THEN
        RAISE EXCEPTION 'research event revision requires an existing event';
    END IF;
    IF event_status = 'RETRACTED' AND NEW."revisionKind" <> 'RETRACTED' THEN
        RAISE EXCEPTION 'retracted research event cannot receive another revision';
    END IF;
    IF NEW."revisionKind" IN ('CORRECTED', 'REVERIFIED', 'RETRACTED')
       AND NEW."supersedesRevisionId" IS NULL THEN
        RAISE EXCEPTION 'revision kind requires a predecessor';
    END IF;
    IF NEW."supersedesRevisionId" IS NOT NULL THEN
        SELECT "eventId", "revisionNo"
        INTO predecessor_event_id, predecessor_revision_no
        FROM "ResearchEventRevision"
        WHERE "id" = NEW."supersedesRevisionId";

        IF predecessor_event_id IS NULL OR predecessor_event_id <> NEW."eventId" THEN
            RAISE EXCEPTION 'revision predecessor must belong to the same research event';
        END IF;
        IF predecessor_revision_no >= NEW."revisionNo" THEN
            RAISE EXCEPTION 'revision predecessor must precede the new revision';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEventRevision_chain_guard"
BEFORE INSERT OR UPDATE OF "eventId", "revisionNo", "revisionKind", "supersedesRevisionId"
ON "ResearchEventRevision"
FOR EACH ROW EXECUTE FUNCTION "validate_event_revision_chain"();

CREATE OR REPLACE FUNCTION "validate_candidate_current_decision"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."currentDecisionId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ResearchEventCandidateDecision"
        WHERE "id" = NEW."currentDecisionId" AND "candidateId" = NEW."id"
    ) THEN
        RAISE EXCEPTION 'current decision must belong to the same research event candidate';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEventCandidate_current_decision_guard"
BEFORE INSERT OR UPDATE OF "currentDecisionId" ON "ResearchEventCandidate"
FOR EACH ROW EXECUTE FUNCTION "validate_candidate_current_decision"();

CREATE OR REPLACE FUNCTION "validate_resource_permit"() RETURNS TRIGGER AS $$
DECLARE
    task_pool_id TEXT;
    task_fencing_token BIGINT;
    pool_current_concurrency INTEGER;
    active_permit_count INTEGER;
BEGIN
    SELECT "resourcePoolId", "fencingToken"
    INTO task_pool_id, task_fencing_token
    FROM "ResearchTask"
    WHERE "id" = NEW."taskId"
    FOR SHARE;

    IF task_pool_id IS NULL OR task_pool_id <> NEW."resourcePoolId" THEN
        RAISE EXCEPTION 'resource permit must use the task resource pool';
    END IF;
    IF NEW."status" = 'ACTIVE' THEN
        IF task_fencing_token <> NEW."fencingToken" THEN
            RAISE EXCEPTION 'resource permit fencing token is stale';
        END IF;

        SELECT "currentConcurrency"
        INTO pool_current_concurrency
        FROM "ResearchResourcePool"
        WHERE "id" = NEW."resourcePoolId"
        FOR UPDATE;

        IF pool_current_concurrency IS NULL THEN
            RAISE EXCEPTION 'resource permit requires an existing resource pool';
        END IF;
        SELECT COUNT(*)::INTEGER
        INTO active_permit_count
        FROM "ResearchResourcePermit"
        WHERE "resourcePoolId" = NEW."resourcePoolId"
          AND "status" = 'ACTIVE'
          AND "id" <> COALESCE(NEW."id", '');
        IF active_permit_count >= pool_current_concurrency THEN
            RAISE EXCEPTION 'resource pool active permit capacity exceeded';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchResourcePermit_guard"
BEFORE INSERT OR UPDATE OF "resourcePoolId", "taskId", "fencingToken", "status"
ON "ResearchResourcePermit"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_permit"();

CREATE OR REPLACE FUNCTION "validate_resource_pool_capacity"() RETURNS TRIGGER AS $$
DECLARE
    active_permit_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER
    INTO active_permit_count
    FROM "ResearchResourcePermit"
    WHERE "resourcePoolId" = NEW."id" AND "status" = 'ACTIVE';
    IF NEW."currentConcurrency" < active_permit_count
       OR NEW."hardConcurrency" < active_permit_count THEN
        RAISE EXCEPTION 'resource pool concurrency cannot be below active permits';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchResourcePool_capacity_guard"
BEFORE UPDATE OF "currentConcurrency", "hardConcurrency"
ON "ResearchResourcePool"
FOR EACH ROW EXECUTE FUNCTION "validate_resource_pool_capacity"();

CREATE OR REPLACE FUNCTION "validate_relevance_assessment_user"() RETURNS TRIGGER AS $$
DECLARE
    snapshot_user_id TEXT;
BEGIN
    SELECT "userId" INTO snapshot_user_id
    FROM "ResearchPreferenceSnapshot"
    WHERE "id" = NEW."preferenceSnapshotId"
    FOR SHARE;

    IF NEW."userId" IS NULL AND NEW."personalDataDeletedAt" IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF snapshot_user_id IS NULL AND NEW."userId" IS NOT NULL THEN
        RAISE EXCEPTION 'relevance assessment user must match the preference snapshot user';
    END IF;
    IF snapshot_user_id IS NOT NULL AND NEW."userId" IS DISTINCT FROM snapshot_user_id THEN
        RAISE EXCEPTION 'relevance assessment user must match the preference snapshot user';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEventRelevanceAssessment_user_guard"
BEFORE INSERT OR UPDATE OF "userId", "preferenceSnapshotId"
ON "ResearchEventRelevanceAssessment"
FOR EACH ROW EXECUTE FUNCTION "validate_relevance_assessment_user"();

CREATE OR REPLACE FUNCTION "validate_inbox_feedback_user"() RETURNS TRIGGER AS $$
DECLARE
    entry_user_id TEXT;
BEGIN
    SELECT "userId" INTO entry_user_id
    FROM "ResearchInboxEntry"
    WHERE "id" = NEW."entryId"
    FOR SHARE;

    IF entry_user_id IS NULL OR entry_user_id <> NEW."userId" THEN
        RAISE EXCEPTION 'inbox feedback user must match the inbox entry user';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchInboxFeedback_user_guard"
BEFORE INSERT OR UPDATE OF "entryId", "userId"
ON "ResearchInboxFeedback"
FOR EACH ROW EXECUTE FUNCTION "validate_inbox_feedback_user"();

CREATE OR REPLACE FUNCTION "validate_revision_source_observation"() RETURNS TRIGGER AS $$
DECLARE
    revision_identity TEXT;
    assertion_identity TEXT;
BEGIN
    SELECT o."identityKey" INTO revision_identity
    FROM "DataObservationRevision" r
    JOIN "DataObservation" o ON o."id" = r."observationId"
    WHERE r."id" = NEW."revisionId";

    SELECT "observationIdentityKey" INTO assertion_identity
    FROM "SourceAssertion"
    WHERE "id" = NEW."sourceAssertionId";

    IF revision_identity IS DISTINCT FROM assertion_identity THEN
        RAISE EXCEPTION 'revision source assertion must target the same observation identity';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataObservationRevisionSource_observation_guard"
BEFORE INSERT OR UPDATE ON "DataObservationRevisionSource"
FOR EACH ROW EXECUTE FUNCTION "validate_revision_source_observation"();

CREATE OR REPLACE FUNCTION "validate_revision_input_acyclic"() RETURNS TRIGGER AS $$
BEGIN
    IF NEW."revisionId" = NEW."inputRevisionId" OR EXISTS (
        WITH RECURSIVE ancestors("revisionId") AS (
            SELECT NEW."inputRevisionId"
            UNION
            SELECT input."inputRevisionId"
            FROM "DataObservationRevisionInput" input
            JOIN ancestors ON input."revisionId" = ancestors."revisionId"
        )
        SELECT 1 FROM ancestors WHERE "revisionId" = NEW."revisionId"
    ) THEN
        RAISE EXCEPTION 'data observation revision input cycle is not allowed';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataObservationRevisionInput_cycle_guard"
BEFORE INSERT OR UPDATE ON "DataObservationRevisionInput"
FOR EACH ROW EXECUTE FUNCTION "validate_revision_input_acyclic"();

-- 追加式历史拒绝 UPDATE/DELETE；少数当前投影和运行表由业务事务更新。
CREATE OR REPLACE FUNCTION "reject_immutable_history_change"() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SourceAssertion_immutable" BEFORE UPDATE OR DELETE ON "SourceAssertion" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "DataObservationRevision_immutable" BEFORE UPDATE OR DELETE ON "DataObservationRevision" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "DataObservationRevisionSource_immutable" BEFORE UPDATE OR DELETE ON "DataObservationRevisionSource" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "DataObservationRevisionInput_immutable" BEFORE UPDATE OR DELETE ON "DataObservationRevisionInput" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "HomepageDataManifestItem_immutable" BEFORE UPDATE OR DELETE ON "HomepageDataManifestItem" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "HomepageDataManifestItemSettlement_immutable" BEFORE UPDATE OR DELETE ON "HomepageDataManifestItemSettlement" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "HomepageDataManifestItemSettlementRevision_immutable" BEFORE UPDATE OR DELETE ON "HomepageDataManifestItemSettlementRevision" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "HomepageSnapshot_immutable" BEFORE UPDATE OR DELETE ON "HomepageSnapshot" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchCandidateMaterial_immutable" BEFORE UPDATE OR DELETE ON "ResearchCandidateMaterial" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventCandidateEvidence_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventCandidateEvidence" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventCandidateDecision_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventCandidateDecision" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventRevision_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventRevision" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventClaim_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventClaim" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventClaimCitation_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventClaimCitation" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventImpact_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventImpact" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchEventGlobalAssessment_immutable" BEFORE UPDATE OR DELETE ON "ResearchEventGlobalAssessment" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchInboxEntryHistory_immutable" BEFORE UPDATE OR DELETE ON "ResearchInboxEntryHistory" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchInboxFeedback_immutable" BEFORE UPDATE OR DELETE ON "ResearchInboxFeedback" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();
CREATE TRIGGER "ResearchAuditRecord_immutable" BEFORE UPDATE OR DELETE ON "ResearchAuditRecord" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_history_change"();

CREATE OR REPLACE FUNCTION "guard_data_observation_identity"() RETURNS TRIGGER AS $$
BEGIN
    IF (OLD."identityKey", OLD."canonicalizationVersion", OLD."subjectType", OLD."subjectKey", OLD."metricCatalogId", OLD."dimensionsJson", OLD."observationKind", OLD."observationDate", OLD."periodStart", OLD."periodEnd")
       IS DISTINCT FROM
       (NEW."identityKey", NEW."canonicalizationVersion", NEW."subjectType", NEW."subjectKey", NEW."metricCatalogId", NEW."dimensionsJson", NEW."observationKind", NEW."observationDate", NEW."periodStart", NEW."periodEnd") THEN
        RAISE EXCEPTION 'DataObservation identity is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DataObservation_identity_immutable"
BEFORE UPDATE ON "DataObservation"
FOR EACH ROW EXECUTE FUNCTION "guard_data_observation_identity"();

CREATE OR REPLACE FUNCTION "guard_homepage_manifest_definition"() RETURNS TRIGGER AS $$
BEGIN
    IF (OLD."manifestKey", OLD."canonicalizationVersion", OLD."scope", OLD."definitionVersion", OLD."targetContextKey", OLD."targetContextJson", OLD."requestNonce", OLD."activationSequence", OLD."userId", OLD."baseManifestId", OLD."frozenPreferenceContractVersion", OLD."frozenPreferenceJson")
       IS DISTINCT FROM
       (NEW."manifestKey", NEW."canonicalizationVersion", NEW."scope", NEW."definitionVersion", NEW."targetContextKey", NEW."targetContextJson", NEW."requestNonce", NEW."activationSequence", NEW."userId", NEW."baseManifestId", NEW."frozenPreferenceContractVersion", NEW."frozenPreferenceJson") THEN
        RAISE EXCEPTION 'HomepageDataManifest definition is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HomepageDataManifest_definition_immutable"
BEFORE UPDATE ON "HomepageDataManifest"
FOR EACH ROW EXECUTE FUNCTION "guard_homepage_manifest_definition"();

CREATE OR REPLACE FUNCTION "guard_manifest_attempt_identity"() RETURNS TRIGGER AS $$
BEGIN
    IF (OLD."manifestItemId", OLD."attemptNo", OLD."idempotencyKey", OLD."providerKey", OLD."providerContractVersion", OLD."normalizationRulesVersion", OLD."requestFingerprint", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."manifestItemId", NEW."attemptNo", NEW."idempotencyKey", NEW."providerKey", NEW."providerContractVersion", NEW."normalizationRulesVersion", NEW."requestFingerprint", NEW."createdAt") THEN
        RAISE EXCEPTION 'HomepageDataManifestItemAttempt identity is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HomepageDataManifestItemAttempt_identity_immutable"
BEFORE UPDATE ON "HomepageDataManifestItemAttempt"
FOR EACH ROW EXECUTE FUNCTION "guard_manifest_attempt_identity"();

CREATE OR REPLACE FUNCTION "guard_research_event_identity"() RETURNS TRIGGER AS $$
BEGIN
    IF (OLD."eventKey", OLD."canonicalizationVersion", OLD."subjectType", OLD."subjectKey", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."eventKey", NEW."canonicalizationVersion", NEW."subjectType", NEW."subjectKey", NEW."createdAt") THEN
        RAISE EXCEPTION 'ResearchEvent identity is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEvent_identity_immutable"
BEFORE UPDATE ON "ResearchEvent"
FOR EACH ROW EXECUTE FUNCTION "guard_research_event_identity"();

CREATE OR REPLACE FUNCTION "guard_research_inbox_fact"() RETURNS TRIGGER AS $$
BEGIN
    IF (OLD."distributionKey", OLD."userId", OLD."eventRevisionId", OLD."candidateId", OLD."globalAssessmentId", OLD."relevanceAssessmentId", OLD."preferenceSnapshotId", OLD."highestChannel", OLD."entryKind", OLD."title", OLD."summary", OLD."bodyJson", OLD."createdAt")
       IS DISTINCT FROM
       (NEW."distributionKey", NEW."userId", NEW."eventRevisionId", NEW."candidateId", NEW."globalAssessmentId", NEW."relevanceAssessmentId", NEW."preferenceSnapshotId", NEW."highestChannel", NEW."entryKind", NEW."title", NEW."summary", NEW."bodyJson", NEW."createdAt") THEN
        RAISE EXCEPTION 'ResearchInboxEntry authoritative content is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchInboxEntry_fact_immutable"
BEFORE UPDATE ON "ResearchInboxEntry"
FOR EACH ROW EXECUTE FUNCTION "guard_research_inbox_fact"();

CREATE OR REPLACE FUNCTION "guard_preference_snapshot_privacy"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ResearchPreferenceSnapshot is referenced history and cannot be deleted';
    END IF;
    IF OLD."personalDataDeletedAt" IS NULL
       AND NEW."personalDataDeletedAt" IS NOT NULL
       AND NEW."normalizedItemsJson" IS NULL
       AND NEW."userId" IS NULL
       AND (OLD."id", OLD."contractVersion", OLD."enabled", OLD."urgentAlertsEnabled", OLD."briefingsEnabled", OLD."externalCopiesEnabled", OLD."contentHash", OLD."frozenAt", OLD."createdAt")
           IS NOT DISTINCT FROM
           (NEW."id", NEW."contractVersion", NEW."enabled", NEW."urgentAlertsEnabled", NEW."briefingsEnabled", NEW."externalCopiesEnabled", NEW."contentHash", NEW."frozenAt", NEW."createdAt") THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ResearchPreferenceSnapshot is immutable outside personal data deletion';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchPreferenceSnapshot_privacy_guard"
BEFORE UPDATE OR DELETE ON "ResearchPreferenceSnapshot"
FOR EACH ROW EXECUTE FUNCTION "guard_preference_snapshot_privacy"();

CREATE OR REPLACE FUNCTION "guard_preference_snapshot_item_privacy"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' AND EXISTS (
        SELECT 1 FROM "ResearchPreferenceSnapshot"
        WHERE "id" = OLD."snapshotId" AND "personalDataDeletedAt" IS NOT NULL
    ) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'ResearchPreferenceSnapshotItem is immutable outside personal data deletion';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchPreferenceSnapshotItem_privacy_guard"
BEFORE UPDATE OR DELETE ON "ResearchPreferenceSnapshotItem"
FOR EACH ROW EXECUTE FUNCTION "guard_preference_snapshot_item_privacy"();

CREATE OR REPLACE FUNCTION "guard_relevance_assessment_privacy"() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ResearchEventRelevanceAssessment is referenced history and cannot be deleted';
    END IF;
    IF OLD."personalDataDeletedAt" IS NULL
       AND NEW."personalDataDeletedAt" IS NOT NULL
       AND NEW."matchedPreferencesJson" IS NULL
       AND NEW."dimensionJson" IS NULL
       AND NEW."inputSnapshotJson" IS NULL
       AND NEW."userId" IS NULL
       AND (OLD."id", OLD."eventRevisionId", OLD."preferenceSnapshotId", OLD."inputHash", OLD."contractVersion", OLD."model", OLD."promptVersion", OLD."schemaVersion", OLD."relevance", OLD."directFocusMatch", OLD."usageJson", OLD."createdAt")
           IS NOT DISTINCT FROM
           (NEW."id", NEW."eventRevisionId", NEW."preferenceSnapshotId", NEW."inputHash", NEW."contractVersion", NEW."model", NEW."promptVersion", NEW."schemaVersion", NEW."relevance", NEW."directFocusMatch", NEW."usageJson", NEW."createdAt") THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'ResearchEventRelevanceAssessment is immutable outside personal data deletion';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResearchEventRelevanceAssessment_privacy_guard"
BEFORE UPDATE OR DELETE ON "ResearchEventRelevanceAssessment"
FOR EACH ROW EXECUTE FUNCTION "guard_relevance_assessment_privacy"();

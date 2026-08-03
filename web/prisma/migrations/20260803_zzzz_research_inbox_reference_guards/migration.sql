CREATE OR REPLACE FUNCTION "validate_research_inbox_references"() RETURNS TRIGGER AS $$
DECLARE
    global_revision_id TEXT;
    relevance_revision_id TEXT;
    relevance_user_id TEXT;
    relevance_snapshot_id TEXT;
    snapshot_user_id TEXT;
    snapshot_deleted_at TIMESTAMPTZ;
    task_user_id TEXT;
    task_type TEXT;
    scope_user_id TEXT;
    scope_snapshot_id TEXT;
BEGIN
    IF ((NEW."eventRevisionId" IS NOT NULL)::INT
      + (NEW."candidateId" IS NOT NULL)::INT
      + (NEW."briefingTaskId" IS NOT NULL)::INT) <> 1 THEN
        RAISE EXCEPTION 'ResearchInboxEntry must bind exactly one authoritative subject';
    END IF;

    IF NEW."eventRevisionId" IS NOT NULL THEN
        IF NEW."entryKind" NOT IN ('EVENT', 'CORRECTION', 'RETRACTION') THEN
            RAISE EXCEPTION 'event revision inbox entry kind is invalid';
        END IF;
        IF NEW."globalAssessmentId" IS NULL
          OR NEW."relevanceAssessmentId" IS NULL
          OR NEW."preferenceSnapshotId" IS NULL THEN
            RAISE EXCEPTION 'event inbox entry requires global, relevance and preference references';
        END IF;

        SELECT "eventRevisionId" INTO global_revision_id
          FROM "ResearchEventGlobalAssessment"
         WHERE "id" = NEW."globalAssessmentId";
        IF global_revision_id IS NULL OR global_revision_id <> NEW."eventRevisionId" THEN
            RAISE EXCEPTION 'global assessment must belong to the event revision';
        END IF;

        SELECT "eventRevisionId", "userId", "preferenceSnapshotId"
          INTO relevance_revision_id, relevance_user_id, relevance_snapshot_id
          FROM "ResearchEventRelevanceAssessment"
         WHERE "id" = NEW."relevanceAssessmentId";
        IF relevance_revision_id IS NULL
          OR relevance_revision_id <> NEW."eventRevisionId"
          OR relevance_user_id IS DISTINCT FROM NEW."userId"
          OR relevance_snapshot_id IS DISTINCT FROM NEW."preferenceSnapshotId" THEN
            RAISE EXCEPTION 'relevance assessment must belong to the event, user and preference snapshot';
        END IF;
    ELSE
        IF NEW."entryKind" = 'CANDIDATE_PENDING_VERIFICATION' THEN
            IF NEW."globalAssessmentId" IS NOT NULL OR NEW."relevanceAssessmentId" IS NOT NULL THEN
                RAISE EXCEPTION 'candidate inbox entry cannot bind event assessments';
            END IF;
        ELSIF NEW."briefingTaskId" IS NOT NULL THEN
            IF NEW."entryKind" <> 'BRIEFING' OR NEW."preferenceSnapshotId" IS NULL THEN
                RAISE EXCEPTION 'briefing inbox entry requires a briefing scope and preference snapshot';
            END IF;
        ELSE
            RAISE EXCEPTION 'inbox entry subject kind is invalid';
        END IF;
    END IF;

    IF NEW."preferenceSnapshotId" IS NOT NULL THEN
        SELECT "userId", "personalDataDeletedAt"
          INTO snapshot_user_id, snapshot_deleted_at
          FROM "ResearchPreferenceSnapshot"
         WHERE "id" = NEW."preferenceSnapshotId";
        IF snapshot_user_id IS DISTINCT FROM NEW."userId" THEN
            RAISE EXCEPTION 'preference snapshot must belong to the inbox user';
        END IF;
        IF snapshot_deleted_at IS NOT NULL THEN
            RAISE EXCEPTION 'deleted preference snapshot cannot be used for inbox delivery';
        END IF;
    END IF;

    IF NEW."briefingTaskId" IS NOT NULL THEN
        SELECT "userId", "taskType"
          INTO task_user_id, task_type
          FROM "ResearchTask"
         WHERE "id" = NEW."briefingTaskId";
        IF task_user_id IS DISTINCT FROM NEW."userId" OR task_type <> 'research.briefing.v1' THEN
            RAISE EXCEPTION 'briefing task must belong to the inbox user';
        END IF;
        SELECT "userId", "preferenceSnapshotId"
          INTO scope_user_id, scope_snapshot_id
          FROM "ResearchBriefingScope"
         WHERE "taskId" = NEW."briefingTaskId";
        IF scope_user_id IS DISTINCT FROM NEW."userId"
          OR scope_snapshot_id IS DISTINCT FROM NEW."preferenceSnapshotId" THEN
            RAISE EXCEPTION 'briefing task must match its frozen scope';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "ResearchInboxEntry_reference_guard" ON "ResearchInboxEntry";
CREATE TRIGGER "ResearchInboxEntry_reference_guard"
BEFORE INSERT OR UPDATE OF "userId", "eventRevisionId", "candidateId", "briefingTaskId",
  "globalAssessmentId", "relevanceAssessmentId", "preferenceSnapshotId", "entryKind"
ON "ResearchInboxEntry"
FOR EACH ROW EXECUTE FUNCTION "validate_research_inbox_references"();

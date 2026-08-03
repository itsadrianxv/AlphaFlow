DROP INDEX IF EXISTS "ResearchInboxEntry_distributionKey_key";

CREATE UNIQUE INDEX "ResearchInboxEntry_userId_distributionKey_key"
ON "ResearchInboxEntry"("userId", "distributionKey");

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

DROP TRIGGER IF EXISTS "ResearchInboxEntry_fact_immutable" ON "ResearchInboxEntry";
CREATE TRIGGER "ResearchInboxEntry_fact_immutable"
BEFORE UPDATE ON "ResearchInboxEntry"
FOR EACH ROW EXECUTE FUNCTION "guard_research_inbox_fact"();

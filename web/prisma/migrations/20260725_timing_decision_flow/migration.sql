ALTER TABLE "PortfolioSnapshot"
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SAVED',
ADD COLUMN "workflowRunId" TEXT;

ALTER TABLE "TimingPreset"
ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'USER',
ADD COLUMN "templateKey" TEXT;

ALTER TABLE "TimingPresetRevision"
ADD COLUMN "templateVersion" INTEGER,
ADD COLUMN "validationSource" TEXT;

ALTER TABLE "TimingRecommendation" ALTER COLUMN "watchListId" DROP NOT NULL;
ALTER TABLE "TimingBacktestRun" ALTER COLUMN "watchListId" DROP NOT NULL;

CREATE UNIQUE INDEX "PortfolioSnapshot_workflowRunId_key" ON "PortfolioSnapshot"("workflowRunId");
CREATE UNIQUE INDEX "TimingPreset_userId_templateKey_key" ON "TimingPreset"("userId", "templateKey");

ALTER TABLE "PortfolioSnapshot"
ADD CONSTRAINT "PortfolioSnapshot_workflowRunId_fkey"
FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

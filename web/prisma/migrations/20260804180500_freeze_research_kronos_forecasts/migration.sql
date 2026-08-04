DELETE FROM "TimingResearchReport";
DELETE FROM "TimingKronosForecastSnapshot";

DROP INDEX "TimingKronos_user_stock_date_model_input_key";

ALTER TABLE "TimingKronosForecastSnapshot"
ADD COLUMN "researchRunId" TEXT NOT NULL;

CREATE UNIQUE INDEX "TimingKronos_user_run_stock_date_model_input_key"
ON "TimingKronosForecastSnapshot"("userId", "researchRunId", "stockCode", "asOfDate", "timeframe", "modelName", "predictionLength", "inputBarsHash");

ALTER TABLE "TimingResearchReport"
ADD COLUMN "modelEvidence" JSONB NOT NULL;

CREATE TABLE "TimingResearchReportForecastSnapshot" (
    "reportId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    CONSTRAINT "TimingResearchReportForecastSnapshot_pkey" PRIMARY KEY ("reportId", "snapshotId")
);

CREATE INDEX "TimingResearchReportForecastSnapshot_snapshotId_idx"
ON "TimingResearchReportForecastSnapshot"("snapshotId");

ALTER TABLE "TimingResearchReportForecastSnapshot"
ADD CONSTRAINT "TimingResearchReportForecastSnapshot_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "TimingResearchReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimingResearchReportForecastSnapshot"
ADD CONSTRAINT "TimingResearchReportForecastSnapshot_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "TimingKronosForecastSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

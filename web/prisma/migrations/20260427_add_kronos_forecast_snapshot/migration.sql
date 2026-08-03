-- CreateTable
CREATE TABLE "TimingKronosForecastSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "lookbackDays" INTEGER NOT NULL,
    "predictionLength" INTEGER NOT NULL,
    "inputBarsHash" TEXT NOT NULL,
    "forecastJson" JSONB NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "warnings" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimingKronosForecastSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_idx" ON "TimingKronosForecastSnapshot"("userId", "stockCode", "asOfDate");

-- CreateIndex
CREATE INDEX "TimingKronosForecastSnapshot_workflowRunId_idx" ON "TimingKronosForecastSnapshot"("workflowRunId");

-- CreateIndex
CREATE INDEX "TimingKronosForecastSnapshot_sourceType_sourceId_idx" ON "TimingKronosForecastSnapshot"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_mode_key" ON "TimingKronosForecastSnapshot"("userId", "stockCode", "asOfDate", "modelName", "predictionLength", "inputBarsHash");

-- AddForeignKey
ALTER TABLE "TimingKronosForecastSnapshot" ADD CONSTRAINT "TimingKronosForecastSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimingKronosForecastSnapshot" ADD CONSTRAINT "TimingKronosForecastSnapshot_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

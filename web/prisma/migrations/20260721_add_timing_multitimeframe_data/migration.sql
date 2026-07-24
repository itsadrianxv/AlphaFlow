ALTER TABLE "TimingSignalSnapshot"
ADD COLUMN "barsByTimeframe" JSONB;

ALTER TABLE "TimingKronosForecastSnapshot"
ADD COLUMN "timeframe" TEXT NOT NULL DEFAULT 'DAILY';

DROP INDEX IF EXISTS "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_idx";

CREATE INDEX "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_timeframe_idx"
ON "TimingKronosForecastSnapshot"("userId", "stockCode", "asOfDate", "timeframe");

DROP INDEX IF EXISTS "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_modelName_predictionLength_inputBarsHash_key";

CREATE UNIQUE INDEX "TimingKronosForecastSnapshot_userId_stockCode_asOfDate_timeframe_modelName_predictionLength_inputBarsHash_key"
ON "TimingKronosForecastSnapshot"("userId", "stockCode", "asOfDate", "timeframe", "modelName", "predictionLength", "inputBarsHash");

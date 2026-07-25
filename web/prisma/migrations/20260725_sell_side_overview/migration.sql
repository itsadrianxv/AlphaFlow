CREATE TABLE "SellSideBrokerRecommendation" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "tsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellSideBrokerRecommendation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellSideBrokerRecommendation_month_broker_tsCode_key" ON "SellSideBrokerRecommendation"("month", "broker", "tsCode");
CREATE INDEX "SellSideBrokerRecommendation_month_tsCode_idx" ON "SellSideBrokerRecommendation"("month", "tsCode");

CREATE TABLE "SellSideEarningsForecast" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "tsCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportDate" TEXT NOT NULL,
    "reportTitle" TEXT,
    "orgName" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "eps" DOUBLE PRECISION,
    "netProfit" DOUBLE PRECISION,
    "rating" TEXT,
    "maxPrice" DOUBLE PRECISION,
    "minPrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellSideEarningsForecast_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SellSideEarningsForecast_sourceKey_key" ON "SellSideEarningsForecast"("sourceKey");
CREATE INDEX "SellSideEarningsForecast_tsCode_orgName_quarter_reportDate_idx" ON "SellSideEarningsForecast"("tsCode", "orgName", "quarter", "reportDate");
CREATE INDEX "SellSideEarningsForecast_reportDate_idx" ON "SellSideEarningsForecast"("reportDate");

CREATE TABLE "SellSideRefreshState" (
    "id" TEXT NOT NULL,
    "latestRecommendationMonth" TEXT,
    "latestForecastDate" TEXT,
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SellSideRefreshState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSpace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "briefJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSpaceRunLink" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSpaceRunLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSpaceWatchListLink" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "watchListId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSpaceWatchListLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSpaceStockLink" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "stockName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSpaceStockLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchSpace_userId_updatedAt_idx" ON "ResearchSpace"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ResearchSpace_userId_name_idx" ON "ResearchSpace"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSpaceRunLink_spaceId_runId_key" ON "ResearchSpaceRunLink"("spaceId", "runId");

-- CreateIndex
CREATE INDEX "ResearchSpaceRunLink_spaceId_createdAt_idx" ON "ResearchSpaceRunLink"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSpaceRunLink_runId_idx" ON "ResearchSpaceRunLink"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSpaceWatchListLink_spaceId_watchListId_key" ON "ResearchSpaceWatchListLink"("spaceId", "watchListId");

-- CreateIndex
CREATE INDEX "ResearchSpaceWatchListLink_spaceId_createdAt_idx" ON "ResearchSpaceWatchListLink"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSpaceWatchListLink_watchListId_idx" ON "ResearchSpaceWatchListLink"("watchListId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSpaceStockLink_spaceId_stockCode_key" ON "ResearchSpaceStockLink"("spaceId", "stockCode");

-- CreateIndex
CREATE INDEX "ResearchSpaceStockLink_spaceId_createdAt_idx" ON "ResearchSpaceStockLink"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchSpaceStockLink_stockCode_idx" ON "ResearchSpaceStockLink"("stockCode");

-- AddForeignKey
ALTER TABLE "ResearchSpace" ADD CONSTRAINT "ResearchSpace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSpaceRunLink" ADD CONSTRAINT "ResearchSpaceRunLink_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ResearchSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSpaceRunLink" ADD CONSTRAINT "ResearchSpaceRunLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSpaceWatchListLink" ADD CONSTRAINT "ResearchSpaceWatchListLink_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ResearchSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSpaceWatchListLink" ADD CONSTRAINT "ResearchSpaceWatchListLink_watchListId_fkey" FOREIGN KEY ("watchListId") REFERENCES "WatchList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSpaceStockLink" ADD CONSTRAINT "ResearchSpaceStockLink_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "ResearchSpace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

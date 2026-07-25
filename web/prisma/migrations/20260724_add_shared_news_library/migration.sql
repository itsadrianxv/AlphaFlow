CREATE TABLE "SharedNewsDaySync" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "leaseExpiresAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SharedNewsDaySync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedNewsDaySync_date_key" ON "SharedNewsDaySync"("date");
CREATE INDEX "SharedNewsDaySync_status_leaseExpiresAt_idx" ON "SharedNewsDaySync"("status", "leaseExpiresAt");

CREATE TABLE "SharedNewsItem" (
    "id" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SharedNewsItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedNewsItem_sourceItemId_key" ON "SharedNewsItem"("sourceItemId");
CREATE INDEX "SharedNewsItem_publishedAt_idx" ON "SharedNewsItem"("publishedAt");
CREATE INDEX "SharedNewsItem_sourceKind_publishedAt_idx" ON "SharedNewsItem"("sourceKind", "publishedAt");
CREATE INDEX "SharedNewsItem_contentHash_idx" ON "SharedNewsItem"("contentHash");

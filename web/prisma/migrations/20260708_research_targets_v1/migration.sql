-- CreateTable
CREATE TABLE "SavedCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockCode" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "reason" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedIndustry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedCompaniesJson" JSONB NOT NULL DEFAULT '[]',
    "metadataJson" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedIndustry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "title" TEXT,
    "kind" TEXT,
    "contentMarkdown" TEXT NOT NULL,
    "rawContent" TEXT,
    "sourceJson" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "companyRefsJson" JSONB NOT NULL,
    "metricSetJson" JSONB NOT NULL,
    "periodRangeJson" JSONB NOT NULL,
    "rawSnapshotJson" JSONB NOT NULL,
    "sourceJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchArtifact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "financialSnapshotId" TEXT,
    "artifactType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "sourceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedCompany_userId_stockCode_key" ON "SavedCompany"("userId", "stockCode");
CREATE INDEX "SavedCompany_userId_updatedAt_idx" ON "SavedCompany"("userId", "updatedAt");
CREATE INDEX "SavedCompany_userId_archivedAt_idx" ON "SavedCompany"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedIndustry_userId_source_name_key" ON "SavedIndustry"("userId", "source", "name");
CREATE INDEX "SavedIndustry_userId_updatedAt_idx" ON "SavedIndustry"("userId", "updatedAt");
CREATE INDEX "SavedIndustry_userId_archivedAt_idx" ON "SavedIndustry"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "ResearchNote_userId_targetType_targetId_updatedAt_idx" ON "ResearchNote"("userId", "targetType", "targetId", "updatedAt");
CREATE INDEX "ResearchNote_userId_updatedAt_idx" ON "ResearchNote"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_userId_targetType_targetId_createdAt_idx" ON "FinancialSnapshot"("userId", "targetType", "targetId", "createdAt");
CREATE INDEX "FinancialSnapshot_userId_createdAt_idx" ON "FinancialSnapshot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchArtifact_userId_targetType_targetId_updatedAt_idx" ON "ResearchArtifact"("userId", "targetType", "targetId", "updatedAt");
CREATE INDEX "ResearchArtifact_financialSnapshotId_idx" ON "ResearchArtifact"("financialSnapshotId");
CREATE INDEX "ResearchArtifact_userId_artifactType_updatedAt_idx" ON "ResearchArtifact"("userId", "artifactType", "updatedAt");

-- AddForeignKey
ALTER TABLE "SavedCompany" ADD CONSTRAINT "SavedCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedIndustry" ADD CONSTRAINT "SavedIndustry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResearchArtifact" ADD CONSTRAINT "ResearchArtifact_financialSnapshotId_fkey" FOREIGN KEY ("financialSnapshotId") REFERENCES "FinancialSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

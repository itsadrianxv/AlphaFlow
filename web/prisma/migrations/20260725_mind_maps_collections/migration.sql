CREATE TYPE "CollectionType" AS ENUM ('COMPANY', 'INDUSTRY', 'WATCHLIST');

CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collectionType" "CollectionType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MindMap" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "data" JSONB NOT NULL,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MindMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionMindMap" (
    "collectionId" TEXT NOT NULL,
    "mindMapId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionMindMap_pkey" PRIMARY KEY ("collectionId", "mindMapId")
);

CREATE TABLE "MindMapReference" (
    "id" TEXT NOT NULL,
    "mindMapId" TEXT NOT NULL,
    "nodeId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MindMapReference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Collection_userId_collectionType_title_key" ON "Collection"("userId", "collectionType", "title");
CREATE INDEX "Collection_userId_collectionType_updatedAt_idx" ON "Collection"("userId", "collectionType", "updatedAt");
CREATE INDEX "Collection_userId_archivedAt_idx" ON "Collection"("userId", "archivedAt");
CREATE INDEX "MindMap_userId_updatedAt_idx" ON "MindMap"("userId", "updatedAt");
CREATE INDEX "CollectionMindMap_mindMapId_createdAt_idx" ON "CollectionMindMap"("mindMapId", "createdAt");
CREATE INDEX "MindMapReference_mindMapId_nodeId_idx" ON "MindMapReference"("mindMapId", "nodeId");
CREATE INDEX "MindMapReference_targetType_targetId_idx" ON "MindMapReference"("targetType", "targetId");

ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MindMap" ADD CONSTRAINT "MindMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionMindMap" ADD CONSTRAINT "CollectionMindMap_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionMindMap" ADD CONSTRAINT "CollectionMindMap_mindMapId_fkey" FOREIGN KEY ("mindMapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MindMapReference" ADD CONSTRAINT "MindMapReference_mindMapId_fkey" FOREIGN KEY ("mindMapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

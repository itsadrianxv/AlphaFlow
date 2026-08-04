CREATE TABLE "UserSkill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSkillVersion" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSkillVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSkillVersion_skillId_version_key" ON "UserSkillVersion"("skillId", "version");
CREATE INDEX "UserSkill_userId_enabled_updatedAt_idx" ON "UserSkill"("userId", "enabled", "updatedAt");
CREATE INDEX "UserSkill_userId_archivedAt_updatedAt_idx" ON "UserSkill"("userId", "archivedAt", "updatedAt");
CREATE INDEX "UserSkillVersion_skillId_createdAt_idx" ON "UserSkillVersion"("skillId", "createdAt");

ALTER TABLE "UserSkill" ADD CONSTRAINT "UserSkill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSkillVersion" ADD CONSTRAINT "UserSkillVersion_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "UserSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

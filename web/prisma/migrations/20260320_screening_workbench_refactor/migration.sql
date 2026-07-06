-- AlterEnum
BEGIN;
CREATE TYPE "ResearchReminderTargetType_new" AS ENUM ('TIMING_REVIEW');
ALTER TABLE "ResearchReminder" ALTER COLUMN "targetType" TYPE "ResearchReminderTargetType_new" USING ("targetType"::text::"ResearchReminderTargetType_new");
ALTER TYPE "ResearchReminderTargetType" RENAME TO "ResearchReminderTargetType_old";
ALTER TYPE "ResearchReminderTargetType_new" RENAME TO "ResearchReminderTargetType";
DROP TYPE "public"."ResearchReminderTargetType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ResearchReminder" DROP CONSTRAINT "ResearchReminder_screeningInsightId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningInsight" DROP CONSTRAINT "ScreeningInsight_screeningSessionId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningInsight" DROP CONSTRAINT "ScreeningInsight_userId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningInsight" DROP CONSTRAINT "ScreeningInsight_watchListId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningInsightVersion" DROP CONSTRAINT "ScreeningInsightVersion_insightId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningSession" DROP CONSTRAINT "ScreeningSession_strategyId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningSession" DROP CONSTRAINT "ScreeningSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "ScreeningStrategy" DROP CONSTRAINT "ScreeningStrategy_userId_fkey";

-- DropIndex
DROP INDEX "ResearchReminder_screeningInsightId_idx";

-- DropIndex
DROP INDEX "ResearchReminder_screeningInsightId_reminderType_scheduledA_key";

-- AlterTable
ALTER TABLE "ResearchReminder" DROP COLUMN "screeningInsightId";

-- DropTable
DROP TABLE "ScreeningInsight";

-- DropTable
DROP TABLE "ScreeningInsightVersion";

-- DropTable
DROP TABLE "ScreeningSession";

-- DropTable
DROP TABLE "ScreeningStrategy";

-- DropEnum
DROP TYPE "ScreeningInsightStatus";

-- DropEnum
DROP TYPE "ScreeningSessionStatus";

-- CreateTable
CREATE TABLE "ScreeningWorkspace" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stockCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "indicatorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "formulaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeConfig" JSONB NOT NULL,
    "filterRules" JSONB NOT NULL,
    "sortState" JSONB,
    "columnState" JSONB NOT NULL,
    "resultSnapshot" JSONB,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreeningFormula" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "targetIndicators" JSONB NOT NULL,
    "description" TEXT,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreeningFormula_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScreeningWorkspace_userId_updatedAt_idx" ON "ScreeningWorkspace"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ScreeningWorkspace_userId_createdAt_idx" ON "ScreeningWorkspace"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreeningWorkspace_userId_name_idx" ON "ScreeningWorkspace"("userId", "name");

-- CreateIndex
CREATE INDEX "ScreeningFormula_userId_updatedAt_idx" ON "ScreeningFormula"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScreeningFormula_userId_name_key" ON "ScreeningFormula"("userId", "name");

-- AddForeignKey
ALTER TABLE "ScreeningWorkspace" ADD CONSTRAINT "ScreeningWorkspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreeningFormula" ADD CONSTRAINT "ScreeningFormula_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


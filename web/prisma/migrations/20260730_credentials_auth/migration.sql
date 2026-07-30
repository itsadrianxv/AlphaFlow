TRUNCATE TABLE "User" CASCADE;

CREATE TYPE "LoginIdentifierType" AS ENUM ('PHONE', 'EMAIL');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

ALTER TABLE "User"
  ADD COLUMN "loginIdentifier" TEXT,
  ADD COLUMN "loginIdentifierType" "LoginIdentifierType",
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_loginIdentifier_key" ON "User"("loginIdentifier");

-- V07: 保留研究偏好命令幂等键，避免旧命令在后续写入后重复产生副作用。
CREATE TABLE "ResearchPreferenceCommand" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commandType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchPreferenceCommand_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchPreferenceCommand_commandId_key"
ON "ResearchPreferenceCommand"("commandId");

CREATE INDEX "ResearchPreferenceCommand_userId_createdAt_idx"
ON "ResearchPreferenceCommand"("userId", "createdAt");

ALTER TABLE "ResearchPreferenceCommand"
ADD CONSTRAINT "ResearchPreferenceCommand_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

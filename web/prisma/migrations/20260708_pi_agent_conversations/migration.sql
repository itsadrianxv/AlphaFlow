CREATE TYPE "AgentConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TYPE "AgentConversationMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TYPE "AgentConversationMessageStatus" AS ENUM ('PENDING', 'STREAMING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "AgentConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AgentConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "piSessionId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "AgentConversationMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "skillId" TEXT,
    "status" "AgentConversationMessageStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "workflowRunId" TEXT,
    "sequence" INTEGER NOT NULL,
    "metadata" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentConversation_piSessionId_key" ON "AgentConversation"("piSessionId");

CREATE INDEX "AgentConversation_userId_lastMessageAt_idx" ON "AgentConversation"("userId", "lastMessageAt");

CREATE INDEX "AgentConversation_userId_status_idx" ON "AgentConversation"("userId", "status");

CREATE UNIQUE INDEX "AgentConversationMessage_conversationId_sequence_key" ON "AgentConversationMessage"("conversationId", "sequence");

CREATE INDEX "AgentConversationMessage_conversationId_createdAt_idx" ON "AgentConversationMessage"("conversationId", "createdAt");

CREATE UNIQUE INDEX "AgentConversationMessage_workflowRunId_key" ON "AgentConversationMessage"("workflowRunId");

ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentConversationMessage" ADD CONSTRAINT "AgentConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentConversationMessage" ADD CONSTRAINT "AgentConversationMessage_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

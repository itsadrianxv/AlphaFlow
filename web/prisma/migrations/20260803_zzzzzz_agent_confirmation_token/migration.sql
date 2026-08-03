CREATE TABLE "AgentConfirmationToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "intentType" TEXT NOT NULL,
    "objectIdentityHash" TEXT NOT NULL,
    "canonicalPayloadHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sideEffectKind" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "consumedResultHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentConfirmationToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentConfirmationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE UNIQUE INDEX "AgentConfirmationToken_tokenHash_key" ON "AgentConfirmationToken"("tokenHash");
CREATE UNIQUE INDEX "AgentConfirmationToken_nonceHash_key" ON "AgentConfirmationToken"("nonceHash");
CREATE INDEX "AgentConfirmationToken_userId_intentId_expiresAt_idx" ON "AgentConfirmationToken"("userId", "intentId", "expiresAt");

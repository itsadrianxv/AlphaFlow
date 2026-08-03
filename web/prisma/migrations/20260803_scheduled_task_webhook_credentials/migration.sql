-- 项目尚未部署，旧的环境变量目标仅保留为非评分任务兼容入口；评分任务凭证改为数据库密文。
CREATE TABLE "ScheduledTaskDeliveryCredential" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "maskedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScheduledTaskDeliveryCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledTaskDeliveryCredential_taskId_channel_createdAt_idx"
ON "ScheduledTaskDeliveryCredential"("taskId", "channel", "createdAt");

CREATE INDEX "ScheduledTaskDeliveryCredential_userId_channel_createdAt_idx"
ON "ScheduledTaskDeliveryCredential"("userId", "channel", "createdAt");

ALTER TABLE "ScheduledTaskDeliveryCredential"
ADD CONSTRAINT "ScheduledTaskDeliveryCredential_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ScheduledTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ScheduledTaskDeliveryCredential"
ADD CONSTRAINT "ScheduledTaskDeliveryCredential_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

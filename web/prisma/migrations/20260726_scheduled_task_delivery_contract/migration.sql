-- 当前项目仅包含 mock 定时任务。清理旧契约数据，同时移除曾误存于 outputSpec 的 Webhook。
DELETE FROM "ScheduledTask";

ALTER TYPE "ScheduledTaskDeliveryStatus" ADD VALUE 'SENDING' BEFORE 'SENT';

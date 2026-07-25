import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import type { AgentRuntimeConfig } from "./types";

export type ScheduledTaskEvent = { eventId: string; eventType: "execution.started" | "execution.succeeded" | "execution.failed" | "execution.cancelled"; executionId: string; taskId: string; taskVersionId: string; runId: string; status: string; resultRef: string; occurredAt: string; attempt: string; errorCode?: string; errorMessage?: string };

export class ScheduledTaskEventPublisher {
  private readonly redis: Redis;
  constructor(private readonly config: Pick<AgentRuntimeConfig, "redisUrl" | "scheduledTaskEventStream" | "scheduledTaskEventMaxLen">) { this.redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true }); }
  async publish(event: Omit<ScheduledTaskEvent, "eventId" | "occurredAt">) {
    const payload: ScheduledTaskEvent = { ...event, eventId: randomUUID(), occurredAt: new Date().toISOString() };
    const fields = Object.entries(payload).flatMap(([key, value]) => [key, value ?? ""]);
    return this.redis.xadd(this.config.scheduledTaskEventStream, "MAXLEN", "~", this.config.scheduledTaskEventMaxLen, "*", ...fields);
  }
  async close() { await this.redis.quit(); }
}

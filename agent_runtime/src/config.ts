import type { AgentRuntimeConfig } from "./types";

function readNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readConfig(): AgentRuntimeConfig {
  return {
    host: process.env.AGENT_RUNTIME_HOST ?? "0.0.0.0",
    port: readNumber("AGENT_RUNTIME_PORT", 8020),
    sessionRoot:
      process.env.AGENT_RUNTIME_SESSION_ROOT ?? "temp/agent-runtime-sessions",
    compactionTokenThreshold: readNumber(
      "AGENT_RUNTIME_COMPACTION_TOKEN_THRESHOLD",
      48_000,
    ),
    webInternalUrl:
      process.env.ALPHAFLOW_WEB_INTERNAL_URL ?? "http://web:3000",
    internalApiSecret: process.env.ALPHAFLOW_INTERNAL_API_SECRET ?? "",
    pythonServiceUrl:
      process.env.PYTHON_SERVICE_URL ?? "http://python-service:8000",
    pythonServiceTimeoutMs: readNumber("PYTHON_SERVICE_TIMEOUT_MS", 60_000),
    runTtlMs: readNumber("AGENT_RUNTIME_RUN_TTL_MS", 30 * 60_000),
    toolTimeoutMs: readNumber("AGENT_RUNTIME_TOOL_TIMEOUT_MS", 60_000),
    modelProvider: process.env.AGENT_RUNTIME_MODEL_PROVIDER ?? "deepseek",
    modelId: process.env.AGENT_RUNTIME_MODEL_ID ?? "deepseek-v4-flash",
    modelTimeoutMs: readNumber("AGENT_RUNTIME_MODEL_TIMEOUT_MS", 120_000),
    modelMaxRetries: readNumber("AGENT_RUNTIME_MODEL_MAX_RETRIES", 1),
    redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",
    scheduledTaskEventStream: process.env.SCHEDULED_TASK_EVENT_STREAM ?? "scheduled-task:events",
    scheduledTaskEventMaxLen: readNumber("SCHEDULED_TASK_EVENT_MAXLEN", 10_000),
  };
}

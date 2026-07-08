export type AgentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRuntimeEventType =
  | "run.created"
  | "run.started"
  | "agent.message"
  | "tool.call.started"
  | "tool.call.completed"
  | "tool.call.failed"
  | "artifact.created"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled";

export type AgentRuntimeEvent = {
  runId: string;
  sequence: number;
  type: AgentRuntimeEventType;
  timestamp: string;
  message?: string;
  payload?: Record<string, unknown>;
};

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  type: "prompt" | "tool";
  permissions: string[];
};

export type StartRunRequest = {
  runId: string;
  skillId: string;
  prompt: string;
  title?: string;
  context?: Record<string, unknown>;
};

export type AgentRunSnapshot = {
  id: string;
  status: AgentRunStatus;
  skillId: string;
  title: string;
  input: {
    prompt: string;
    context?: Record<string, unknown>;
  };
  finalOutput?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  events: AgentRuntimeEvent[];
};

export type ToolAuditPayload = {
  toolCallId: string;
  toolName: string;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type AgentRuntimeConfig = {
  host: string;
  port: number;
  pythonServiceUrl: string;
  pythonServiceTimeoutMs: number;
  runTtlMs: number;
  maxToolCallsPerRun: number;
  toolTimeoutMs: number;
  modelProvider: string;
  modelId: string;
  modelTimeoutMs: number;
  modelMaxRetries: number;
};

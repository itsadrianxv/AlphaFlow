export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRuntimeEventType =
  | "run.created"
  | "run.started"
  | "run.boundary.frozen"
  | "run.audit.recorded"
  | "candidate_seed.queued"
  | "agent.message.start"
  | "agent.message.delta"
  | "agent.message"
  | "tool.call.started"
  | "tool.call.completed"
  | "tool.call.failed"
  | "user.input.requested"
  | "artifact.created"
  | "session.compacted"
  | "run.waiting_for_input"
  | "run.resumed"
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
  category: string;
  type: "prompt" | "tool";
  permissions: string[];
};

export type UserSkillDefinition = {
  id: string;
  versionId: string;
  version: number;
  name: string;
  description: string;
  content: string;
  contentHash: string;
};

export type StartRunRequest = {
  runId: string;
  userId: string;
  sessionId?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  skillId: string;
  skillIds?: string[];
  prompt: string;
  title?: string;
  context?: Record<string, unknown>;
  sessionSeed?: AgentRuntimeSeedMessage[];
  userSkillDefinitions?: UserSkillDefinition[];
  allowedCapabilities?: string[];
  capabilityConstraints?: Record<string, unknown>;
  executionBoundary?: Record<string, unknown>;
  networkPolicy?: {
    allowPublicHttp?: boolean;
    allowPrivateNetwork?: boolean;
    allowCredentialedUrls?: boolean;
    allowedSchemes?: string[];
  };
};

export type ScheduledTaskRunRequest = {
  executionId: string;
  taskId: string;
  taskVersionId: string;
  userId: string;
  runId: string;
  executionPlan: Record<string, unknown>;
  allowedCapabilities: string[];
  scheduledAt: string;
};

export type AgentRuntimeSeedMessage = {
  role: "user" | "assistant";
  content: string;
  skillId?: string;
};

export type UserInputRequest = {
  question: string;
  options?: Array<{
    label: string;
    value: string;
  }>;
};

export type AgentRuntimeResumeRequest = {
  prompt: string;
  userMessageId: string;
  assistantMessageId: string;
};

export type AgentRunSnapshot = {
  id: string;
  status: AgentRunStatus;
  skillId: string;
  skillIds?: string[];
  title: string;
  input: {
    prompt: string;
    skillIds?: string[];
    userSkillDefinitions?: UserSkillDefinition[];
    context?: Record<string, unknown>;
    executionBoundary?: Record<string, unknown>;
  };
  finalOutput?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  waitingForInput?: UserInputRequest;
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
  sessionRoot: string;
  compactionTokenThreshold: number;
  webInternalUrl: string;
  internalApiSecret: string;
  pythonServiceUrl: string;
  pythonServiceTimeoutMs: number;
  runTtlMs: number;
  maxToolCallsPerRun: number;
  toolTimeoutMs: number;
  modelProvider: string;
  modelId: string;
  modelTimeoutMs: number;
  modelMaxRetries: number;
  redisUrl: string;
  scheduledTaskEventStream: string;
  scheduledTaskEventMaxLen: number;
};

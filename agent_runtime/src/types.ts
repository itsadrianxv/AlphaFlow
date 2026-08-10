export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentRunKind = "immediate_research" | "scheduled_task";

export type AgentInteractionMode =
  | "research"
  | "scheduled_task_setup"
  | "scheduled_task_edit"
  | "scheduled_task_execution";

export type CapabilityConstraintRequest = {
  internal_tushare_dataset?: {
    allowedDatasets: string[];
    maxRows: number;
    maxLookbackDays: number;
  };
};

export type NetworkPolicyNarrowing = {
  allowPublicHttp?: boolean;
  allowPrivateNetwork?: false;
  allowCredentialedUrls?: false;
  allowedSchemes?: Array<"http" | "https">;
};

export type AgentPolicyRequest = {
  requestedCapabilities?: string[];
  capabilityConstraints?: CapabilityConstraintRequest;
  network?: NetworkPolicyNarrowing;
  maxConcurrentSubtasks?: number;
  costWarning?: { currency: "USD"; micros: number };
};

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
  runKind: AgentRunKind;
  interactionMode: AgentInteractionMode;
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
  policy?: AgentPolicyRequest;
  scheduledTask?: ScheduledTaskRunRequest;
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
    runKind: AgentRunKind;
    interactionMode: AgentInteractionMode;
    prompt: string;
    skillIds?: string[];
    userSkillDefinitions?: UserSkillDefinition[];
    context?: Record<string, unknown>;
    executionSnapshot?: import("./agent-execution").AgentExecutionSnapshot;
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
  toolTimeoutMs: number;
  modelProvider: string;
  modelId: string;
  modelTimeoutMs: number;
  modelMaxRetries: number;
  redisUrl: string;
  scheduledTaskEventStream: string;
  scheduledTaskEventMaxLen: number;
};

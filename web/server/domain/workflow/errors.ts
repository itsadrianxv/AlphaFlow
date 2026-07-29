export const WORKFLOW_ERROR_CODES = {
  WORKFLOW_TEMPLATE_NOT_FOUND: "WORKFLOW_TEMPLATE_NOT_FOUND",
  WORKFLOW_RUN_NOT_FOUND: "WORKFLOW_RUN_NOT_FOUND",
  WORKFLOW_RUN_FORBIDDEN: "WORKFLOW_RUN_FORBIDDEN",
  WORKFLOW_INVALID_STATUS_TRANSITION: "WORKFLOW_INVALID_STATUS_TRANSITION",
  WORKFLOW_NODE_EXECUTION_FAILED: "WORKFLOW_NODE_EXECUTION_FAILED",
  WORKFLOW_NODE_TIMEOUT: "WORKFLOW_NODE_TIMEOUT",
  WORKFLOW_CANCEL_NOT_ALLOWED: "WORKFLOW_CANCEL_NOT_ALLOWED",
  INTELLIGENCE_DATA_UNAVAILABLE: "INTELLIGENCE_DATA_UNAVAILABLE",
  TIMING_DATA_UNAVAILABLE: "TIMING_DATA_UNAVAILABLE",
  INTELLIGENCE_LLM_PARSE_FAILED: "INTELLIGENCE_LLM_PARSE_FAILED",
} as const;

export type WorkflowErrorCode =
  (typeof WORKFLOW_ERROR_CODES)[keyof typeof WORKFLOW_ERROR_CODES];

export class WorkflowDomainError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = "WorkflowDomainError";
    this.code = code;
  }
}

export function isWorkflowDomainError(
  error: unknown,
): error is WorkflowDomainError {
  return error instanceof WorkflowDomainError;
}

export class WorkflowPauseError extends Error {
  readonly reason: string;
  readonly state?: Record<string, unknown>;

  constructor(
    message: string,
    reason: string,
    state?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkflowPauseError";
    this.reason = reason;
    this.state = state;
  }
}

export class WorkflowNodeTimeoutError extends Error {
  readonly nodeKey: string;
  readonly timeoutMs: number;

  constructor(nodeKey: string, timeoutMs: number) {
    super(`节点 ${nodeKey} 执行超过 ${timeoutMs}ms，已暂停等待用户指示`);
    this.name = "WorkflowNodeTimeoutError";
    this.nodeKey = nodeKey;
    this.timeoutMs = timeoutMs;
  }
}

export class RunCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunCancelledError";
  }
}

export function isWorkflowPauseError(
  error: unknown,
): error is WorkflowPauseError {
  return error instanceof WorkflowPauseError;
}

export const WORKFLOW_ERROR_CODES = {
  WORKFLOW_TEMPLATE_NOT_FOUND: "WORKFLOW_TEMPLATE_NOT_FOUND",
  WORKFLOW_RUN_NOT_FOUND: "WORKFLOW_RUN_NOT_FOUND",
  WORKFLOW_RUN_FORBIDDEN: "WORKFLOW_RUN_FORBIDDEN",
  WORKFLOW_INVALID_STATUS_TRANSITION: "WORKFLOW_INVALID_STATUS_TRANSITION",
  WORKFLOW_NODE_EXECUTION_FAILED: "WORKFLOW_NODE_EXECUTION_FAILED",
  WORKFLOW_CANCEL_NOT_ALLOWED: "WORKFLOW_CANCEL_NOT_ALLOWED",
  INTELLIGENCE_DATA_UNAVAILABLE: "INTELLIGENCE_DATA_UNAVAILABLE",
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

export function isWorkflowDomainError(error: unknown): error is WorkflowDomainError {
  return error instanceof WorkflowDomainError;
}

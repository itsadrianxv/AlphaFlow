export const TIMING_ERROR_CODES = {
  TIMING_DATA_UNAVAILABLE: "TIMING_DATA_UNAVAILABLE",
  TIMING_CARD_NOT_FOUND: "TIMING_CARD_NOT_FOUND",
  INVALID_TIMING_ACTION: "INVALID_TIMING_ACTION",
  INVALID_TIMING_SOURCE_TYPE: "INVALID_TIMING_SOURCE_TYPE",
} as const;

export type TimingErrorCode =
  (typeof TIMING_ERROR_CODES)[keyof typeof TIMING_ERROR_CODES];

export class TimingDomainError extends Error {
  readonly code: TimingErrorCode;

  constructor(code: TimingErrorCode, message: string) {
    super(message);
    this.name = "TimingDomainError";
    this.code = code;
  }
}

export function isTimingDomainError(
  error: unknown,
): error is TimingDomainError {
  return error instanceof TimingDomainError;
}

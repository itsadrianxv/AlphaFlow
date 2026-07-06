/**
 * 筛选会话状态
 */
export enum ScreeningSessionStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

export function isScreeningSessionTerminalStatus(
  status: ScreeningSessionStatus,
): boolean {
  return (
    status === ScreeningSessionStatus.SUCCEEDED ||
    status === ScreeningSessionStatus.FAILED ||
    status === ScreeningSessionStatus.CANCELLED
  );
}

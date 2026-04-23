export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: string | undefined): StatusTone {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "PAUSED":
      return "warning";
    case "RUNNING":
      return "info";
    case "PENDING":
      return "warning";
    default:
      return "neutral";
  }
}

export type AgentMessageDisplayStatus =
  | "PENDING"
  | "STREAMING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export function resolveAgentMessageText(params: {
  persistedText: string;
  status: AgentMessageDisplayStatus;
  liveText?: string;
}) {
  if (params.status !== "PENDING" && params.status !== "STREAMING") {
    return params.persistedText;
  }

  if (params.liveText === undefined) {
    return params.persistedText;
  }

  return params.liveText.length >= params.persistedText.length
    ? params.liveText
    : params.persistedText;
}

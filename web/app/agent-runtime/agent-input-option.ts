export type AgentInputOption = {
  label: string;
  value: string;
};

export function formatAgentInputOptionPrompt(option: AgentInputOption) {
  return `用户选择：${option.label}（value: ${option.value}）`;
}

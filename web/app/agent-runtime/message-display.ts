export type AgentMessageDisplayStatus =
  | "PENDING"
  | "STREAMING"
  | "WAITING_FOR_INPUT"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AgentMessageSections = {
  mainContent: string;
  reasoningContent: string;
};

const REASONING_SECTION_TITLES = new Set([
  "分析过程",
  "推理过程",
  "推理依据",
  "reasoning",
]);

function normalizeMarkdownHeadingTitle(title: string) {
  return title
    .replace(/[：:]+$/g, "")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();
}

function joinMainContent(before: string, after: string) {
  const normalizedBefore = before.trimEnd();
  const normalizedAfter = after.trimStart();

  if (!normalizedBefore) {
    return normalizedAfter;
  }

  if (!normalizedAfter) {
    return normalizedBefore;
  }

  return `${normalizedBefore}\n\n${normalizedAfter}`;
}

function findLineEnd(content: string, startIndex: number) {
  const newlineIndex = content.indexOf("\n", startIndex);
  return newlineIndex === -1 ? content.length : newlineIndex + 1;
}

export function splitAgentReasoningSection(
  content: string,
): AgentMessageSections {
  const headingPattern = /^ {0,3}(#{2,3})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
  const reasoningHeading = [...content.matchAll(headingPattern)].find((match) =>
    REASONING_SECTION_TITLES.has(normalizeMarkdownHeadingTitle(match[2] ?? "")),
  );

  if (reasoningHeading?.index === undefined) {
    return { mainContent: content, reasoningContent: "" };
  }

  const reasoningLevel = reasoningHeading[1]?.length ?? 2;
  const reasoningStart = reasoningHeading.index;
  const reasoningContentStart = findLineEnd(content, reasoningStart);

  let reasoningEnd = content.length;
  for (const match of content
    .slice(reasoningContentStart)
    .matchAll(headingPattern)) {
    const nextLevel = match[1]?.length ?? 2;
    if (nextLevel <= reasoningLevel) {
      reasoningEnd = reasoningContentStart + (match.index ?? 0);
      break;
    }
  }

  return {
    mainContent: joinMainContent(
      content.slice(0, reasoningStart),
      content.slice(reasoningEnd),
    ),
    reasoningContent: content.slice(reasoningContentStart, reasoningEnd).trim(),
  };
}

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

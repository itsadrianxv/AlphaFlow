import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Pi Agent selection draft handoff", () => {
  const highlightSource = readFileSync(
    "app/_components/highlight-to-note.tsx",
    "utf8",
  );
  const agentRuntimeSource = readFileSync(
    "app/agent-runtime/agent-runtime-client.tsx",
    "utf8",
  );
  const draftSource = readFileSync(
    "app/agent-runtime/selection-draft.ts",
    "utf8",
  );

  it("adds an ask Pi Agent action to the floating highlight toolbar", () => {
    expect(highlightSource).toContain("writePiAgentSelectionDraft");
    expect(highlightSource).toContain("询问 Pi Agent");
    expect(highlightSource).toContain('"/agent-runtime?draft=selection"');
    expect(highlightSource).toContain("无法暂存选中文本");
  });

  it("stores the selected text in session storage instead of the URL", () => {
    expect(draftSource).toContain(
      '"stock-screening-boost:pi-agent-selection-draft"',
    );
    expect(draftSource).toContain("window.sessionStorage.setItem");
    expect(draftSource).toContain("JSON.stringify(draft)");
    expect(draftSource).toContain("parsed.text.slice(0, 4000)");
  });

  it("prefills the Pi Agent composer from the draft without sending it", () => {
    const draftEffectIndex = agentRuntimeSource.indexOf(
      "consumePiAgentSelectionDraft",
    );
    const sendMutationIndex = agentRuntimeSource.indexOf("const sendMutation");

    expect(agentRuntimeSource).toContain("PI_AGENT_SELECTION_DRAFT_QUERY");
    expect(agentRuntimeSource).toContain("setPrompt((current) =>");
    expect(agentRuntimeSource).toContain("promptTextareaRef.current?.focus()");
    expect(agentRuntimeSource).toContain("router.replace");
    expect(draftEffectIndex).toBeGreaterThanOrEqual(0);
    expect(sendMutationIndex).toBeGreaterThan(draftEffectIndex);
  });

  it("keeps Pi Agent message highlights in the current conversation", () => {
    expect(agentRuntimeSource).toContain("piAgentHref={props.piAgentHref}");
    expect(agentRuntimeSource).toContain(
      "piAgentHref={`/agent-runtime?conversationId=${encodeURIComponent(",
    );
    expect(agentRuntimeSource).toContain(")}&draft=selection`}");
  });
});

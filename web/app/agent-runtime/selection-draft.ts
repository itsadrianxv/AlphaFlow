"use client";

export const PI_AGENT_SELECTION_DRAFT_QUERY = "selection";
export const PI_AGENT_SELECTION_DRAFT_STORAGE_KEY =
  "stock-screening-boost:pi-agent-selection-draft";

export type PiAgentSelectionDraft = {
  text: string;
  createdAt: string;
  source: Record<string, unknown> | null;
};

export function writePiAgentSelectionDraft(
  draft: PiAgentSelectionDraft,
): boolean {
  try {
    window.sessionStorage.setItem(
      PI_AGENT_SELECTION_DRAFT_STORAGE_KEY,
      JSON.stringify(draft),
    );
    return true;
  } catch {
    return false;
  }
}

export function consumePiAgentSelectionDraft(): PiAgentSelectionDraft | null {
  try {
    const raw = window.sessionStorage.getItem(
      PI_AGENT_SELECTION_DRAFT_STORAGE_KEY,
    );
    window.sessionStorage.removeItem(PI_AGENT_SELECTION_DRAFT_STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PiAgentSelectionDraft>;
    if (typeof parsed.text !== "string" || parsed.text.trim().length === 0) {
      return null;
    }

    return {
      text: parsed.text.slice(0, 4000),
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date().toISOString(),
      source:
        parsed.source && typeof parsed.source === "object"
          ? (parsed.source as Record<string, unknown>)
          : null,
    };
  } catch {
    return null;
  }
}

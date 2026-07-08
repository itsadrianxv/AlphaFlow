import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ResearchTargetsClient AI 调格式", () => {
  const source = readFileSync(
    "app/research-targets/research-targets-client.tsx",
    "utf8",
  );

  it("adds AI format actions for notes and research artifacts", () => {
    expect(source).toContain("AI调格式");
    expect(source).toContain("api.researchTarget.formatNote.useMutation");
    expect(source).toContain("api.researchTarget.formatArtifact.useMutation");
  });

  it("tracks formatting state per content item", () => {
    expect(source).toContain("formattingKeys");
    expect(source).toContain("note:${note.id}");
    expect(source).toContain("artifact:${artifact.id}");
    expect(source).toContain("调格式中...");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent research tools internal route", () => {
  const source = readFileSync(
    "app/api/internal/agent/research-tools/route.ts",
    "utf8",
  );

  it("protects the route with an internal secret and Pi Agent run ownership", () => {
    expect(source).toContain("ALPHAFLOW_INTERNAL_API_SECRET");
    expect(source).toContain("X-Alphaflow-Internal-Secret");
    expect(source).toContain("requirePiAgentRun");
    expect(source).toContain("PI_AGENT_RUN_TEMPLATE_CODE");
    expect(source).toContain("RUN_FORBIDDEN");
  });

  it("exposes only read-only research target operations", () => {
    expect(source).toContain("internal_research_targets_list");
    expect(source).toContain("internal_research_target_detail");
    expect(source).toContain("internal_research_notes_list");
    expect(source).toContain("internal_research_artifacts_list");
    expect(source).toContain("internal_watchlist_detail");
    expect(source).not.toContain(".create(");
    expect(source).not.toContain(".update(");
    expect(source).not.toContain(".delete(");
  });

  it("returns previews for long notes and artifacts", () => {
    expect(source).toContain("contentPreview");
    expect(source).toContain("truncated");
    expect(source).toContain("部分笔记内容已截断");
    expect(source).toContain("部分研究报告内容已截断");
  });
});

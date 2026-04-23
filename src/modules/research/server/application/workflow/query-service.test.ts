import { describe, expect, it, vi } from "vitest";
import { WorkflowQueryService } from "~/modules/research/server/application/workflow/query-service";
import { makeNodeResult } from "~/modules/research/server/domain/workflow/flow-spec";
import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/modules/research/server/domain/workflow/types";

describe("WorkflowQueryService", () => {
  it("builds flow metadata and run view for getRun", async () => {
    const repository = {
      getRunDetailForUser: vi.fn(async () => ({
        id: "run_1",
        query: "Research solar",
        status: "RUNNING",
        progressPercent: 48,
        currentNodeKey: "agent4_synthesis",
        input: {
          companyName: "Test Co",
        },
        errorCode: null,
        errorMessage: null,
        result: null,
        template: {
          code: COMPANY_RESEARCH_TEMPLATE_CODE,
          version: 4,
        },
        createdAt: new Date("2026-04-19T12:00:00.000Z"),
        startedAt: new Date("2026-04-19T12:01:00.000Z"),
        completedAt: null,
        nodeRuns: [
          {
            id: "node_1",
            nodeKey: "agent0_clarify_scope",
            agentName: "agent0_clarify_scope",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 120,
            startedAt: new Date("2026-04-19T12:01:00.000Z"),
            completedAt: new Date("2026-04-19T12:01:02.000Z"),
            output: makeNodeResult({
              note: "scope ready",
              data: {
                clarificationRequest: null,
              },
            }),
          },
          {
            id: "node_2",
            nodeKey: "collector_official_sources",
            agentName: "collector_official_sources",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 140,
            startedAt: new Date("2026-04-19T12:01:03.000Z"),
            completedAt: new Date("2026-04-19T12:01:05.000Z"),
            output: makeNodeResult({
              note: "3 official sources",
              data: {
                rawCount: 3,
              },
              stats: {
                rawCount: 3,
              },
            }),
          },
        ],
        events: [],
      })),
    };

    const service = new WorkflowQueryService(repository as never);
    const run = await service.getRun("user_1", "run_1");

    expect(run.flow).toMatchObject({
      templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      templateVersion: 4,
      name: "公司研究",
    });
    expect(
      run.flowMap.nodes.some((node) => node.key === "agent0_clarify_scope"),
    ).toBe(true);
    expect(
      run.flowMap.nodes.some(
        (node) => node.key === "collector_official_sources",
      ),
    ).toBe(false);
    expect(
      run.runView.debug.nodes.some(
        (node) => node.key === "collector_official_sources",
      ),
    ).toBe(true);
  });
});

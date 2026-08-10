import { describe, expect, it } from "vitest";
import type { PythonGatewayClient } from "../src/python-gateway-client";
import { createInternalTools } from "../src/tool-policy";
import type { WebInternalClient } from "../src/web-internal-client";

describe("research target internal tools", () => {
  it("registers the read-only research target tools", () => {
    const tools = createInternalTools({
      pythonGatewayClient: {
        postJson: async () => ({}),
      } as unknown as PythonGatewayClient,
      webInternalClient: {
        postToolOperation: async () => ({}),
      } as unknown as WebInternalClient,
      runId: "run_1",
      userId: "user_1",
      toolTimeoutMs: 1000,
    });

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "internal_research_targets_list",
        "internal_research_target_detail",
        "internal_research_notes_list",
        "internal_research_artifacts_list",
        "internal_watchlist_detail",
      ]),
    );
  });

});

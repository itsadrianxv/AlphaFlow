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
      maxToolCalls: 20,
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

  it("网页读取只允许公开 HTTP(S) 且拒绝凭据、本机、私网和非网络 scheme", async () => {
    const fetchedUrls: string[] = [];
    const tools = createInternalTools({
      pythonGatewayClient: {
        postJson: async (_path: string, body: Record<string, unknown>) => {
          fetchedUrls.push(String(body.url));
          return { ok: true };
        },
      } as unknown as PythonGatewayClient,
      webInternalClient: {
        postToolOperation: async () => ({}),
      } as unknown as WebInternalClient,
      runId: "run_network",
      userId: "user_network",
      maxToolCalls: 20,
      toolTimeoutMs: 1000,
    });
    const tool = tools.find((item) => item.name === "internal_web_fetch");

    await expect(
      tool?.execute("call-public", { url: "https://example.com/report" }, undefined),
    ).resolves.toBeDefined();
    await expect(
      tool?.execute("call-localhost", { url: "https://localhost/admin" }, undefined),
    ).rejects.toThrow("NETWORK_POLICY_BLOCKED");
    await expect(
      tool?.execute("call-private", { url: "http://192.168.1.10/metrics" }, undefined),
    ).rejects.toThrow("NETWORK_POLICY_BLOCKED");
    await expect(
      tool?.execute("call-file", { url: "file:///etc/passwd" }, undefined),
    ).rejects.toThrow("NETWORK_POLICY_BLOCKED");
    await expect(
      tool?.execute("call-credential", { url: "https://user:secret@example.com/report" }, undefined),
    ).rejects.toThrow("NETWORK_POLICY_BLOCKED");
    expect(fetchedUrls).toEqual(["https://example.com/report"]);
  });
});

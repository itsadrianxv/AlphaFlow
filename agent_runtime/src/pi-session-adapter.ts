import path from "node:path";
import {
  estimateContextTokens,
  InMemorySessionRepo,
  JsonlSessionRepo,
  type AgentHarness,
  type AgentMessage,
  type JsonlSessionMetadata,
  type Session,
} from "@earendil-works/pi-agent-core";
import type { AgentSessionSpec, RunnerEvent } from "./agent-runner";
import { RestrictedExecutionEnv } from "./restricted-env";

function createSeedMessage(
  role: "user" | "assistant",
  content: string,
): AgentMessage {
  if (role === "user") {
    return {
      role,
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    };
  }

  return {
    role,
    content: [{ type: "text", text: content }],
    api: "seed",
    provider: "seed",
    model: "seed",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
  };
}

export class PiSessionAdapter {
  private readonly sessionRepo: JsonlSessionRepo;

  constructor(
    sessionRoot: string,
    private readonly compactionTokenThreshold = Number.MAX_SAFE_INTEGER,
  ) {
    const resolvedRoot = path.resolve(sessionRoot);
    const env = new RestrictedExecutionEnv({
      cwd: process.cwd(),
      readRoots: [process.cwd(), resolvedRoot],
      writeRoots: [resolvedRoot],
    });
    this.sessionRepo = new JsonlSessionRepo({
      fs: env,
      sessionsRoot: resolvedRoot,
    });
  }

  async resolve(spec: AgentSessionSpec): Promise<Session> {
    if (spec.mode === "memory") {
      return new InMemorySessionRepo().create({ id: spec.id });
    }

    const cwd = `conversation:${spec.id}`;
    const existing = (await this.sessionRepo.list({ cwd })).find(
      (metadata: JsonlSessionMetadata) => metadata.id === spec.id,
    );
    if (existing) {
      return this.sessionRepo.open(existing);
    }

    const session = await this.sessionRepo.create({ id: spec.id, cwd });
    for (const seed of spec.seed) {
      const content = seed.content.trim();
      if (content) {
        await session.appendMessage(createSeedMessage(seed.role, content));
      }
    }
    return session;
  }

  async compactIfNeeded(params: {
    harness: AgentHarness;
    phase: "before" | "after";
    emit: (event: RunnerEvent) => void;
  }) {
    try {
      const context = await (
        params.harness as unknown as {
          session?: { buildContext(): Promise<{ messages: AgentMessage[] }> };
        }
      ).session?.buildContext();
      const tokenCount = context
        ? estimateContextTokens(context.messages)
        : undefined;
      if (
        typeof tokenCount !== "number" ||
        tokenCount <= this.compactionTokenThreshold
      ) {
        return;
      }
      const result = await params.harness.compact(
        "保留用户明确表达的偏好、分析对象、关键结论、待验证问题和已经完成的工具结果摘要。",
      );
      params.emit({
        type: "session.compacted",
        payload: {
          phase: params.phase,
          tokenCount,
          summary: result.summary,
          firstKeptEntryId: result.firstKeptEntryId,
          tokensBefore: result.tokensBefore,
        },
      });
    } catch (error) {
      params.emit({
        type: "session.compacted",
        payload: {
          phase: params.phase,
          skipped: true,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

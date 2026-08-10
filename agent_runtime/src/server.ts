import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { AgentRunner } from "./agent-runner";
import { RuntimeAgentExecutionFactory } from "./agent-capability-registry";
import { AgentRuntimeService } from "./agent-runtime-service";
import { CandidateSeedOutbox } from "./candidate-seed-outbox";
import { readConfig } from "./config";
import { isRecord } from "./json";
import { PiHarnessAdapter } from "./pi-harness-adapter";
import { PiSessionAdapter } from "./pi-session-adapter";
import { PythonGatewayClient } from "./python-gateway-client";
import { AgentRuntimeRunStore } from "./run-store";
import {
  ImmediateResearchResultHandler,
  ScheduledTaskResultHandler,
} from "./run-result-handlers";
import { ScheduledTaskEventPublisher } from "./scheduled-task-events";
import { SkillRegistry } from "./skill-registry";
import type {
  AgentRuntimeEvent,
  AgentRuntimeResumeRequest,
  AgentPolicyRequest,
  ScheduledTaskRunRequest,
  StartRunRequest,
} from "./types";
import { WebInternalClient } from "./web-internal-client";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function parseRunRequest(value: unknown): StartRunRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const runId = value.runId;
  const userId = value.userId;
  const skillId = value.skillId;
  const runKind = value.runKind;
  const interactionMode = value.interactionMode;
  const rawSkillIds = Array.isArray(value.skillIds) ? value.skillIds : [];
  const prompt = value.prompt;
  const skillIds = [
    ...new Set(
      [...rawSkillIds, skillId]
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (
    typeof runId !== "string" ||
    typeof userId !== "string" ||
    typeof skillId !== "string" ||
    runKind !== "immediate_research" ||
    ![
      "research",
      "scheduled_task_setup",
      "scheduled_task_edit",
    ].includes(String(interactionMode)) ||
    typeof prompt !== "string" ||
    !runId.trim() ||
    !userId.trim() ||
    !skillId.trim() ||
    !prompt.trim() ||
    skillIds.length > 3
  ) {
    return null;
  }

  return {
    runKind,
    interactionMode: interactionMode as StartRunRequest["interactionMode"],
    runId,
    userId,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : undefined,
    conversationId:
      typeof value.conversationId === "string" ? value.conversationId : undefined,
    userMessageId:
      typeof value.userMessageId === "string" ? value.userMessageId : undefined,
    assistantMessageId:
      typeof value.assistantMessageId === "string"
        ? value.assistantMessageId
        : undefined,
    skillId,
    skillIds: skillIds.length > 0 ? skillIds : [skillId],
    prompt,
    title: typeof value.title === "string" ? value.title : undefined,
    context: isRecord(value.context) ? value.context : undefined,
    sessionSeed: Array.isArray(value.sessionSeed)
      ? value.sessionSeed
          .filter(
            (item) =>
              isRecord(item) &&
              (item.role === "user" || item.role === "assistant") &&
              typeof item.content === "string",
          )
          .map((item) => ({
            role: item.role as "user" | "assistant",
            content: item.content as string,
            skillId: typeof item.skillId === "string" ? item.skillId : undefined,
          }))
      : undefined,
    userSkillDefinitions: Array.isArray(value.userSkillDefinitions)
      ? value.userSkillDefinitions
          .filter(
            (item) =>
              isRecord(item) &&
              typeof item.id === "string" &&
              typeof item.versionId === "string" &&
              typeof item.version === "number" &&
              Number.isInteger(item.version) &&
              typeof item.name === "string" &&
              typeof item.description === "string" &&
              typeof item.content === "string" &&
              typeof item.contentHash === "string",
          )
          .map((item) => ({
            id: item.id as string,
            versionId: item.versionId as string,
            version: item.version as number,
            name: item.name as string,
            description: item.description as string,
            content: item.content as string,
            contentHash: item.contentHash as string,
          }))
      : undefined,
    policy: isRecord(value.policy)
      ? (value.policy as AgentPolicyRequest)
      : undefined,
  };
}

function parseScheduledRequest(value: unknown): ScheduledTaskRunRequest | null {
  if (!isRecord(value) || typeof value.executionId !== "string" || typeof value.taskId !== "string" || typeof value.taskVersionId !== "string" || typeof value.userId !== "string" || typeof value.runId !== "string" || !isRecord(value.executionPlan) || !Array.isArray(value.allowedCapabilities) || typeof value.scheduledAt !== "string") return null;
  return { executionId: value.executionId, taskId: value.taskId, taskVersionId: value.taskVersionId, userId: value.userId, runId: value.runId, executionPlan: value.executionPlan, allowedCapabilities: value.allowedCapabilities.filter((v): v is string => typeof v === "string"), scheduledAt: value.scheduledAt };
}

function parseResumeRequest(value: unknown): AgentRuntimeResumeRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const prompt = value.prompt;
  const userMessageId = value.userMessageId;
  const assistantMessageId = value.assistantMessageId;
  if (
    typeof prompt !== "string" ||
    !prompt.trim() ||
    typeof userMessageId !== "string" ||
    !userMessageId.trim() ||
    typeof assistantMessageId !== "string" ||
    !assistantMessageId.trim()
  ) {
    return null;
  }

  return {
    prompt,
    userMessageId,
    assistantMessageId,
  };
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeSseEvent(response: ServerResponse, event: AgentRuntimeEvent) {
  response.write(`id: ${event.sequence}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function main() {
  const config = readConfig();
  const store = new AgentRuntimeRunStore(config.runTtlMs);
  const skillRegistry = await new SkillRegistry().load();
  const webInternalClient = new WebInternalClient(config);
  const pythonGatewayClient = new PythonGatewayClient(config);
  const agentExecutionFactory = new RuntimeAgentExecutionFactory({
    config,
    pythonGatewayClient,
    webInternalClient,
  });
  const candidateSeedOutbox = new CandidateSeedOutbox(
    path.resolve(config.sessionRoot, "candidate-seed-outbox"),
    (payload) => webInternalClient.enqueueResearchCandidateSeed(payload),
  );
  const runtime = new AgentRuntimeService({
    config,
    skillRegistry,
    store,
    runner: new AgentRunner(
      new PiHarnessAdapter(
        config,
        new PiSessionAdapter(
          config.sessionRoot,
          config.compactionTokenThreshold,
        ),
      ),
    ),
    agentExecutionFactory,
    immediateResultHandler: new ImmediateResearchResultHandler(
      candidateSeedOutbox,
    ),
    scheduledResultHandler: new ScheduledTaskResultHandler(
      webInternalClient,
      new ScheduledTaskEventPublisher(config),
    ),
    recoverCandidateSeeds: () =>
      candidateSeedOutbox.recover((file, error) => {
        console.error(
          `[agent-runtime] candidate seed recovery deferred (${file}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }),
  });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { status: "healthy" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/skills") {
        sendJson(response, 200, {
          items: skillRegistry.list(),
          diagnostics: skillRegistry.getDiagnostics(),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        const parsed = parseRunRequest(await readJsonBody(request));
        if (!parsed) {
          sendJson(response, 400, { error: "INVALID_RUN_REQUEST" });
          return;
        }

        const existing = store.snapshot(parsed.runId);
        store.createOrGet(parsed);
        if (!existing || existing.status === "queued" || existing.status === "running") {
          void runtime.start(parsed);
        }

        const run = store.snapshot(parsed.runId);
        sendJson(response, existing ? 200 : 202, run);
        return;
      }

      if (request.method === "POST" && url.pathname === "/internal/scheduled-task-runs") {
        const parsed = parseScheduledRequest(await readJsonBody(request));
        if (!parsed) { sendJson(response, 400, { error: "INVALID_SCHEDULED_TASK_REQUEST" }); return; }
        const existing = store.snapshot(parsed.runId);
        const prompt = `执行已确认的定时任务。executionId=${parsed.executionId}。请严格按照 executionPlan 执行，并只返回结构化 JSON 结果。`;
        const capabilityConstraints = isRecord(parsed.executionPlan.capabilityConstraints)
          ? parsed.executionPlan.capabilityConstraints
          : undefined;
        const run: StartRunRequest = {
          runKind: "scheduled_task",
          interactionMode: "scheduled_task_execution",
          runId: parsed.runId,
          userId: parsed.userId,
          skillId: "scheduled-task-execution",
          skillIds: ["scheduled-task-execution"],
          prompt,
          policy: {
            requestedCapabilities: parsed.allowedCapabilities,
            capabilityConstraints: capabilityConstraints as AgentPolicyRequest["capabilityConstraints"],
          },
          title: "定时任务执行",
          context: {
            executionPlan: parsed.executionPlan,
            allowedCapabilities: parsed.allowedCapabilities,
            scheduledAt: parsed.scheduledAt,
          },
          scheduledTask: parsed,
        };
        store.createOrGet(run);
        if (!existing) void runtime.start(run);
        sendJson(response, existing ? 200 : 202, store.snapshot(parsed.runId));
        return;
      }

      if (parts[0] === "runs" && parts[1] && request.method === "GET" && parts.length === 2) {
        const snapshot = store.snapshot(parts[1]);
        if (!snapshot) {
          sendJson(response, 404, { error: "RUN_NOT_FOUND" });
          return;
        }

        sendJson(response, 200, snapshot);
        return;
      }

      if (
        parts[0] === "runs" &&
        parts[1] &&
        parts[2] === "events" &&
        request.method === "GET"
      ) {
        const snapshot = store.snapshot(parts[1]);
        if (!snapshot) {
          sendJson(response, 404, { error: "RUN_NOT_FOUND" });
          return;
        }

        const afterSequence = Number(
          url.searchParams.get("afterSequence") ??
            request.headers["last-event-id"] ??
            0,
        );

        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        const unsubscribe = store.subscribe(
          parts[1],
          Number.isFinite(afterSequence) ? afterSequence : 0,
          (event) => writeSseEvent(response, event),
        );

        if (!unsubscribe) {
          response.end();
          return;
        }

        const heartbeat = setInterval(() => {
          response.write(`: ping ${Date.now()}\n\n`);
        }, 15_000);

        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
          response.end();
        });
        return;
      }

      if (
        parts[0] === "runs" &&
        parts[1] &&
        parts[2] === "cancel" &&
        request.method === "POST"
      ) {
        const found = store.abort(parts[1]);
        if (!found) {
          sendJson(response, 404, { error: "RUN_NOT_FOUND" });
          return;
        }

        sendJson(response, 200, { success: true });
        return;
      }

      if (
        parts[0] === "runs" &&
        parts[1] &&
        parts[2] === "resume" &&
        request.method === "POST"
      ) {
        const parsed = parseResumeRequest(await readJsonBody(request));
        if (!parsed) {
          sendJson(response, 400, { error: "INVALID_RESUME_REQUEST" });
          return;
        }

        const result = store.resume(parts[1], parsed);
        if (result.kind === "not_found") {
          sendJson(response, 404, { error: "RUN_NOT_FOUND" });
          return;
        }
        if (result.kind === "invalid_status") {
          sendJson(response, 409, {
            error: "RUN_NOT_WAITING_FOR_INPUT",
            status: result.status,
          });
          return;
        }

        if (result.kind === "resumed") {
          void runtime.resume(parts[1]);
        }
        sendJson(response, 200, store.snapshot(parts[1]));
        return;
      }

      sendJson(response, 404, { error: "NOT_FOUND" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      sendJson(response, message === "REQUEST_TOO_LARGE" ? 413 : 500, {
        error: message,
      });
    }
  });

  server.listen(config.port, config.host, () => {
    console.info(
      `[agent-runtime] listening on http://${config.host}:${config.port}`,
    );
  });
}

void main();

import { z } from "zod";

export const nodeKindSchema = z.enum(["agent", "tool", "system", "gate"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;

export const nodeResultStatusSchema = z.enum(["ok", "pause", "skip", "fail"]);
export type NodeResultStatus = z.infer<typeof nodeResultStatusSchema>;

export const nodeRouteSchema = z.object({
  key: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});
export type NodeRoute = z.infer<typeof nodeRouteSchema>;

export const nodeErrorSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
});
export type NodeError = z.infer<typeof nodeErrorSchema>;

export const nodeItemSchema = z.record(z.string(), z.unknown());
export type NodeItem = z.infer<typeof nodeItemSchema>;

export const nodeResultSchema = z.object({
  status: nodeResultStatusSchema,
  data: z.record(z.string(), z.unknown()),
  route: nodeRouteSchema,
  note: z.string().default(""),
  stats: z.record(z.string(), z.unknown()).default({}),
  items: z.array(nodeItemSchema).default([]),
  view: z.record(z.string(), z.unknown()).default({}),
  error: nodeErrorSchema.nullable().default(null),
});
export type NodeResult = z.infer<typeof nodeResultSchema>;

export type StageSpec = {
  key: string;
  name: string;
  note?: string;
};

export type NodeViewSpec = {
  stage: string;
  show: boolean;
};

export type NodeSpec = {
  key: string;
  kind: NodeKind;
  name: string;
  goal: string;
  tools: string[];
  in: z.ZodType<Record<string, unknown>>;
  out: z.ZodType<Record<string, unknown>>;
  routes: string[];
  view: NodeViewSpec;
};

export type EdgeSpec = {
  from: string;
  to: string;
  when: string;
};

export type FlowSpec = {
  templateCode: string;
  templateVersion?: number;
  name: string;
  stages: StageSpec[];
  nodes: NodeSpec[];
  edges: EdgeSpec[];
};

export type FlowMapNode = {
  key: string;
  name: string;
  kind: NodeKind;
  goal: string;
  stage: string;
};

export type FlowMapEdge = EdgeSpec;

export type FlowMap = {
  templateCode: string;
  templateVersion?: number;
  name: string;
  mode: "user" | "debug";
  stages: StageSpec[];
  nodes: FlowMapNode[];
  edges: FlowMapEdge[];
};

export function makeStage(input: StageSpec): StageSpec {
  return {
    key: input.key,
    name: input.name,
    note: input.note,
  };
}

export function makeNode(input: NodeSpec): NodeSpec {
  return {
    ...input,
    tools: [...input.tools],
    routes: [...input.routes],
    view: {
      stage: input.view.stage,
      show: input.view.show,
    },
  };
}

export function makeEdge(input: EdgeSpec): EdgeSpec {
  return {
    from: input.from,
    to: input.to,
    when: input.when,
  };
}

export function buildFlow(input: FlowSpec): FlowSpec {
  return {
    templateCode: input.templateCode,
    templateVersion: input.templateVersion,
    name: input.name,
    stages: input.stages.map(makeStage),
    nodes: input.nodes.map(makeNode),
    edges: input.edges.map(makeEdge),
  };
}

export function makeNodeResult(input?: Partial<NodeResult>): NodeResult {
  return nodeResultSchema.parse({
    status: input?.status ?? "ok",
    data: input?.data ?? {},
    route: input?.route ?? { key: "ok", reason: "done" },
    note: input?.note ?? "",
    stats: input?.stats ?? {},
    items: input?.items ?? [],
    view: input?.view ?? {},
    error: input?.error ?? null,
  });
}

export function parseNodeResult(value: unknown): NodeResult | null {
  const parsed = nodeResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toNodeEventPayload(
  result: NodeResult,
  extra?: Record<string, unknown>,
) {
  return {
    routeKey: result.route.key,
    routeReason: result.route.reason,
    note: result.note,
    ...result.stats,
    error: result.error,
    ...(extra ?? {}),
  };
}

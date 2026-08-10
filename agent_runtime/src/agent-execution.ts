import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  AgentInteractionMode,
  AgentPolicyRequest,
  CapabilityConstraintRequest,
  NetworkPolicyNarrowing,
} from "./types";

export type AgentCapabilityAdapter = AgentTool & { name: string };

export type AgentStopReason =
  | "completed"
  | "waiting_for_input"
  | "cancelled"
  | "boundary_violation"
  | "contract_invalid"
  | "tool_error"
  | "model_error";

export type AgentExecutionSnapshot = {
  version: "agent-execution.v1";
  runId: string;
  objective: string;
  input: Record<string, unknown>;
  skillIds: string[];
  interactionMode: AgentInteractionMode;
  capabilities: string[];
  capabilityConstraints: CapabilityConstraintRequest;
  network: Required<NetworkPolicyNarrowing>;
  maxConcurrentSubtasks: number;
  costWarning?: { currency: "USD"; micros: number };
  model: { provider: string; id: string };
  usage: AgentUsage;
};

export type AgentUsage = {
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costMicros?: number;
  peakConcurrentSubtasks: number;
};

export type AgentExecutionAudit = {
  snapshot: AgentExecutionSnapshot;
  usage: AgentUsage;
  cost?: { currency: "USD"; micros: number };
  costWarningExceeded: boolean;
};

export type AgentUsageEvent =
  | { kind: "step"; count?: number }
  | { kind: "tool"; name: string; summary?: Record<string, unknown> }
  | {
      kind: "model";
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    }
  | { kind: "duration"; durationMs: number };

export type SubtaskPermit = { release(): void };

export type AgentExecution = {
  readonly snapshot: AgentExecutionSnapshot;
  capabilities(): readonly AgentCapabilityAdapter[];
  executeCapability(
    capabilityId: string,
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<unknown>>;
  acquireSubtask(signal?: AbortSignal): Promise<SubtaskPermit>;
  observe(event: AgentUsageEvent): void;
  pause(): AgentExecutionSnapshot;
  audit(): AgentExecutionAudit;
};

type CreateAgentExecutionInput = {
  runId: string;
  objective: string;
  input: Record<string, unknown>;
  skillIds: string[];
  interactionMode: AgentInteractionMode;
  policy?: AgentPolicyRequest;
  model: { provider: string; id: string };
  snapshot?: AgentExecutionSnapshot;
};

type FactoryOptions = {
  modeCapabilities: Record<AgentInteractionMode, readonly string[]>;
  createAdapters: () => readonly AgentCapabilityAdapter[];
};

const DEFAULT_NETWORK: Required<NetworkPolicyNarrowing> = {
  allowPublicHttp: true,
  allowPrivateNetwork: false,
  allowCredentialedUrls: false,
  allowedSchemes: ["http", "https"],
};

function validatePolicy(policy: AgentPolicyRequest | undefined) {
  if (policy === undefined) return undefined;
  if (!isRecord(policy)) throw new Error("Agent policy 必须是对象");
  const unknown = Object.keys(policy).find(
    (key) =>
      ![
        "requestedCapabilities",
        "capabilityConstraints",
        "network",
        "maxConcurrentSubtasks",
        "costWarning",
      ].includes(key),
  );
  if (unknown) throw new Error(`未知策略字段: ${unknown}`);
  if (
    policy.requestedCapabilities !== undefined &&
    (!Array.isArray(policy.requestedCapabilities) ||
      policy.requestedCapabilities.some(
        (item) => typeof item !== "string" || !item.trim(),
      ))
  ) {
    throw new Error("requestedCapabilities 非法");
  }
  if (policy.network !== undefined) {
    if (!isRecord(policy.network)) throw new Error("network 必须是对象");
    const unknownNetworkField = Object.keys(policy.network).find(
      (key) =>
        ![
          "allowPublicHttp",
          "allowPrivateNetwork",
          "allowCredentialedUrls",
          "allowedSchemes",
        ].includes(key),
    );
    if (unknownNetworkField) {
      throw new Error(`未知网络策略字段: ${unknownNetworkField}`);
    }
    if (
      policy.network.allowPublicHttp !== undefined &&
      typeof policy.network.allowPublicHttp !== "boolean"
    ) {
      throw new Error("allowPublicHttp 非法");
    }
    if (
      policy.network.allowedSchemes !== undefined &&
      (!Array.isArray(policy.network.allowedSchemes) ||
        policy.network.allowedSchemes.some(
          (scheme) => scheme !== "http" && scheme !== "https",
        ))
    ) {
      throw new Error("allowedSchemes 非法");
    }
  }
  if (policy.costWarning !== undefined) {
    const warning = policy.costWarning;
    if (
      !isRecord(warning) ||
      Object.keys(warning).some(
        (key) => key !== "currency" && key !== "micros",
      ) ||
      warning.currency !== "USD" ||
      typeof warning.micros !== "number" ||
      !Number.isSafeInteger(warning.micros) ||
      warning.micros < 0
    ) {
      throw new Error("costWarning 非法");
    }
  }
  return policy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeNetwork(policy?: NetworkPolicyNarrowing) {
  const raw = policy as Record<string, unknown> | undefined;
  if (raw?.allowPrivateNetwork === true || raw?.allowCredentialedUrls === true) {
    throw new Error("网络策略只能收窄，不能开放私网或凭据 URL");
  }
  const allowedSchemes = policy?.allowedSchemes ?? DEFAULT_NETWORK.allowedSchemes;
  if (allowedSchemes.some((scheme) => scheme !== "http" && scheme !== "https")) {
    throw new Error("网络策略包含非法 URL scheme");
  }
  if (policy?.allowPublicHttp === false && allowedSchemes.length > 0) {
    return { ...DEFAULT_NETWORK, ...policy, allowedSchemes: [...allowedSchemes] };
  }
  return { ...DEFAULT_NETWORK, ...policy, allowedSchemes: [...allowedSchemes] };
}

function isPrivateHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value === "::1" ||
    value === "::"
  ) return true;
  if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value)) return true;
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateHostname(mappedIpv4);
  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1] ?? "", 16);
    const low = Number.parseInt(mappedHex[2] ?? "", 16);
    return isPrivateHostname(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = -1, b = -1] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function assertNetwork(urlText: string, network: Required<NetworkPolicyNarrowing>) {
  let url: URL;
  try { url = new URL(urlText); } catch { throw new Error("网络策略拒绝: URL 无法解析"); }
  const scheme = url.protocol.slice(0, -1) as "http" | "https";
  if (!network.allowedSchemes.includes(scheme)) throw new Error("网络策略拒绝: scheme 未获准");
  if (!network.allowPublicHttp) throw new Error("网络策略拒绝: 未授权公开网络");
  if (url.username || url.password || network.allowCredentialedUrls) {
    if (url.username || url.password) throw new Error("网络策略拒绝: URL 不得包含凭据");
  }
  if (!network.allowPrivateNetwork && isPrivateHostname(url.hostname)) throw new Error("网络策略拒绝: 不得访问私网");
}

function validateConstraints(capabilities: readonly string[], constraints: CapabilityConstraintRequest | undefined) {
  if (constraints !== undefined && !isRecord(constraints)) {
    throw new Error("capabilityConstraints 必须是对象");
  }
  const value = constraints ?? {};
  for (const [key, raw] of Object.entries(value)) {
    if (key !== "internal_tushare_dataset") throw new Error(`未知 capability constraint: ${key}`);
    if (!capabilities.includes(key)) throw new Error(`未授权能力的 constraint: ${key}`);
    if (!isRecord(raw)) throw new Error(`非法 capability constraint: ${key}`);
    const unknownField = Object.keys(raw).find(
      (field) => !["allowedDatasets", "maxRows", "maxLookbackDays"].includes(field),
    );
    if (unknownField) throw new Error(`internal_tushare_dataset constraint 未知字段: ${unknownField}`);
    const allowed = raw.allowedDatasets;
    if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some((item) => typeof item !== "string" || !item.trim())) throw new Error("internal_tushare_dataset 缺少必需 allowedDatasets");
    if (!Number.isInteger(raw.maxRows) || typeof raw.maxRows !== "number" || raw.maxRows < 1 || raw.maxRows > 500) throw new Error("internal_tushare_dataset.maxRows 缺失或非法");
    if (!Number.isInteger(raw.maxLookbackDays) || typeof raw.maxLookbackDays !== "number" || raw.maxLookbackDays < 1) throw new Error("internal_tushare_dataset.maxLookbackDays 缺失或非法");
  }
  if (capabilities.includes("internal_tushare_dataset") && !isRecord(value.internal_tushare_dataset)) throw new Error("internal_tushare_dataset 缺少必需 constraint");
  return structuredClone(value);
}

function assertTushareInput(
  params: unknown,
  constraint: CapabilityConstraintRequest["internal_tushare_dataset"],
) {
  if (!constraint || !isRecord(params) || typeof params.dataset !== "string") {
    throw new Error("internal_tushare_dataset 输入或 constraint 非法");
  }
  if (!constraint.allowedDatasets.includes(params.dataset)) {
    throw new Error(`执行计划未授权 TuShare 数据集: ${params.dataset}`);
  }
  const requestedRows = params.maxRows;
  if (
    requestedRows !== undefined &&
    (typeof requestedRows !== "number" ||
      !Number.isInteger(requestedRows) ||
      requestedRows < 1)
  ) {
    throw new Error("internal_tushare_dataset.maxRows 非法");
  }
  if (
    typeof requestedRows === "number" &&
    constraint.maxRows !== undefined &&
    requestedRows > constraint.maxRows
  ) {
    throw new Error("TuShare 查询超过执行计划允许的行数");
  }
  const query = isRecord(params.params) ? params.params : {};
  const startText = typeof query.start_date === "string" ? query.start_date.replaceAll("-", "") : "";
  const endText = typeof query.end_date === "string" ? query.end_date.replaceAll("-", "") : "";
  if (constraint.maxLookbackDays !== undefined && /^\d{8}$/.test(startText) && /^\d{8}$/.test(endText)) {
    const start = Date.UTC(Number(startText.slice(0, 4)), Number(startText.slice(4, 6)) - 1, Number(startText.slice(6, 8)));
    const end = Date.UTC(Number(endText.slice(0, 4)), Number(endText.slice(4, 6)) - 1, Number(endText.slice(6, 8)));
    if ((end - start) / 86_400_000 > constraint.maxLookbackDays) {
      throw new Error("TuShare 查询超过执行计划允许的回看窗口");
    }
  }
}

class Execution implements AgentExecution {
  private readonly adapters: Map<string, AgentCapabilityAdapter>;
  private readonly active = new Set<() => void>();
  private waiters: Array<{ resolve: (permit: SubtaskPermit) => void; reject: (error: Error) => void; signal?: AbortSignal }> = [];
  private activeCount = 0;
  private paused = false;

  constructor(private readonly state: AgentExecutionSnapshot, adapters: readonly AgentCapabilityAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.name, adapter]));
    if (this.adapters.size !== adapters.length) throw new Error("能力注册表存在重复 ID");
    for (const capability of state.capabilities) if (!this.adapters.has(capability)) throw new Error(`能力未注册: ${capability}`);
  }

  get snapshot() { return structuredClone(this.state); }

  capabilities() {
    return this.state.capabilities.map((name) => {
      const adapter = this.adapters.get(name)!;
      return { ...adapter, execute: (id: string, params: unknown, signal?: AbortSignal) => this.executeCapability(name, id, params, signal) };
    });
  }

  async executeCapability(capabilityId: string, toolCallId: string, params: unknown, signal?: AbortSignal) {
    const adapter = this.adapters.get(capabilityId);
    if (!adapter || !this.state.capabilities.includes(capabilityId)) throw new Error(`能力未授权: ${capabilityId}`);
    if (capabilityId === "internal_web_fetch") {
      if (!isRecord(params) || typeof params.url !== "string") throw new Error("网络策略拒绝: 缺少 URL");
      assertNetwork(params.url, this.state.network);
    }
    let effectiveParams = params;
    if (capabilityId === "internal_tushare_dataset") {
      const constraint =
        this.state.capabilityConstraints.internal_tushare_dataset;
      assertTushareInput(
        params,
        constraint,
      );
      effectiveParams = {
        ...(params as Record<string, unknown>),
        maxRows:
          typeof (params as Record<string, unknown>).maxRows === "number"
            ? (params as Record<string, unknown>).maxRows
            : constraint?.maxRows,
      };
    }
    this.observe({ kind: "tool", name: capabilityId });
    return adapter.execute(toolCallId, effectiveParams as never, signal);
  }

  async acquireSubtask(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("子任务许可等待已取消");
    if (this.paused) throw new Error("AgentExecution 已暂停，恢复后必须重新 acquire");
    if (this.activeCount < this.state.maxConcurrentSubtasks) return this.takePermit();
    return new Promise<SubtaskPermit>((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      this.waiters.push(waiter);
      signal?.addEventListener("abort", () => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error("子任务许可等待已取消"));
      }, { once: true });
    });
  }

  observe(event: AgentUsageEvent) {
    if (event.kind === "step") this.state.usage.steps += event.count ?? 1;
    if (event.kind === "tool") this.state.usage.toolCalls += 1;
    if (event.kind === "model") {
      this.state.usage.inputTokens += Math.max(0, event.inputTokens ?? 0);
      this.state.usage.outputTokens += Math.max(0, event.outputTokens ?? 0);
      if (event.costUsd !== undefined && Number.isFinite(event.costUsd) && event.costUsd >= 0) this.state.usage.costMicros = (this.state.usage.costMicros ?? 0) + Math.round(event.costUsd * 1_000_000);
    }
    if (event.kind === "duration") this.state.usage.durationMs += Math.max(0, event.durationMs);
  }

  pause() {
    this.paused = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new Error("AgentExecution 已暂停，恢复后必须重新 acquire"));
    }
    for (const release of [...this.active]) release();
    return structuredClone(this.state);
  }

  audit() {
    const cost = this.state.usage.costMicros === undefined ? undefined : { currency: "USD" as const, micros: this.state.usage.costMicros };
    return { snapshot: structuredClone(this.state), usage: { ...this.state.usage }, cost, costWarningExceeded: Boolean(cost && this.state.costWarning && cost.micros > this.state.costWarning.micros) };
  }

  private takePermit(): SubtaskPermit {
    this.activeCount += 1;
    this.state.usage.peakConcurrentSubtasks = Math.max(this.state.usage.peakConcurrentSubtasks, this.activeCount);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.active.delete(release);
      this.activeCount = Math.max(0, this.activeCount - 1);
      const next = this.paused ? undefined : this.waiters.shift();
      if (next) { if (next.signal?.aborted) next.reject(new Error("子任务许可等待已取消")); else { const permit = this.takePermit(); next.resolve(permit); } }
    };
    this.active.add(release);
    return { release };
  }
}

export class AgentExecutionFactory {
  constructor(private readonly options: FactoryOptions) {}

  create(input: CreateAgentExecutionInput): AgentExecution {
    if (input.snapshot) return new Execution(structuredClone(input.snapshot), this.options.createAdapters());
    const policy = validatePolicy(input.policy);
    const ceiling = this.options.modeCapabilities[input.interactionMode] ?? [];
    const requested = policy?.requestedCapabilities;
    const capabilities = requested === undefined ? [...ceiling] : [...new Set(requested)];
    for (const capability of capabilities) {
      if (!this.options.modeCapabilities[input.interactionMode] || !this.options.modeCapabilities[input.interactionMode].includes(capability)) {
        if (![...new Set(Object.values(this.options.modeCapabilities).flat())].includes(capability)) throw new Error(`未知能力: ${capability}`);
        throw new Error("能力不在 interaction mode 上限内");
      }
    }
    const snapshot: AgentExecutionSnapshot = {
      version: "agent-execution.v1",
      runId: input.runId,
      objective: input.objective,
      input: structuredClone(input.input),
      skillIds: [...input.skillIds],
      interactionMode: input.interactionMode,
      capabilities,
      capabilityConstraints: validateConstraints(capabilities, policy?.capabilityConstraints),
      network: normalizeNetwork(policy?.network),
      maxConcurrentSubtasks: policy?.maxConcurrentSubtasks ?? 1,
      costWarning: policy?.costWarning,
      model: input.model,
      usage: { steps: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, peakConcurrentSubtasks: 0 },
    };
    if (!Number.isInteger(snapshot.maxConcurrentSubtasks) || snapshot.maxConcurrentSubtasks < 1) throw new Error("maxConcurrentSubtasks 必须为正整数");
    return new Execution(snapshot, this.options.createAdapters());
  }
}

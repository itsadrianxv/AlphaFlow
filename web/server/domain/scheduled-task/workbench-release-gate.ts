export const SCHEDULED_TASK_WORKBENCH_SECTIONS = [
  { id: "task", label: "任务" },
  { id: "schedule", label: "调度" },
  { id: "universe", label: "范围" },
  { id: "rules", label: "规则" },
  { id: "selection", label: "筛选" },
  { id: "delivery", label: "投递" },
  { id: "preview", label: "预览" },
] as const;

export const SCHEDULED_TASK_LATENCY_TARGETS_MS = {
  localEdit: 100,
  semanticValidation: 800,
  saveOrCreate: 1_500,
} as const;

type LatencyStage = keyof typeof SCHEDULED_TASK_LATENCY_TARGETS_MS;
type ContractTarget = "web" | "python" | "cppWorker" | "postgresql";

export type ScheduledTaskForbiddenCapability =
  | "ARBITRARY_FORMULA"
  | "ARBITRARY_CRON"
  | "ARBITRARY_WEBHOOK"
  | "AGENT_ONLY_CONFIRMATION"
  | "AUTO_ACTIVATE"
  | "BROWSER_ACCEPTANCE";

function percentile95(samples: number[]) {
  if (
    samples.length === 0 ||
    samples.some((sample) => !Number.isFinite(sample) || sample < 0)
  )
    throw new Error("INVALID_LATENCY_EVIDENCE");
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] as number;
}

export function evaluateScheduledTaskRelease(params: {
  latencyMs: Record<LatencyStage, number[]>;
  deterministicPathWaitsForAgent: boolean;
  contractChecks: Record<ContractTarget, boolean>;
  forbiddenCapabilities: ScheduledTaskForbiddenCapability[];
}) {
  const p95Ms = {
    localEdit: percentile95(params.latencyMs.localEdit),
    semanticValidation: percentile95(params.latencyMs.semanticValidation),
    saveOrCreate: percentile95(params.latencyMs.saveOrCreate),
  };
  const failures: string[] = [];
  if (p95Ms.localEdit > SCHEDULED_TASK_LATENCY_TARGETS_MS.localEdit)
    failures.push("LOCAL_EDIT_P95");
  if (
    p95Ms.semanticValidation >
    SCHEDULED_TASK_LATENCY_TARGETS_MS.semanticValidation
  )
    failures.push("SEMANTIC_VALIDATION_P95");
  if (p95Ms.saveOrCreate > SCHEDULED_TASK_LATENCY_TARGETS_MS.saveOrCreate)
    failures.push("SAVE_OR_CREATE_P95");
  if (params.deterministicPathWaitsForAgent)
    failures.push("AGENT_BLOCKS_DETERMINISTIC_PATH");

  const contractFailureNames: Record<ContractTarget, string> = {
    web: "WEB_CONTRACT",
    python: "PYTHON_CONTRACT",
    cppWorker: "CPP_WORKER_CONTRACT",
    postgresql: "POSTGRESQL_CONTRACT",
  };
  for (const target of ["web", "python", "cppWorker", "postgresql"] as const)
    if (!params.contractChecks[target])
      failures.push(contractFailureNames[target]);
  for (const capability of params.forbiddenCapabilities)
    failures.push(`FORBIDDEN_CAPABILITY:${capability}`);

  return { allowed: failures.length === 0, p95Ms, failures };
}

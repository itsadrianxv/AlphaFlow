type DeliveryTargetConfig = {
  type: "FEISHU";
  targetRef: string;
  name: string;
  secretEnvVar: string;
};

export type PublicDeliveryTarget = Pick<
  DeliveryTargetConfig,
  "type" | "targetRef" | "name"
>;

const targetRefPattern = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const secretEnvVarPattern = /^FEISHU_WEBHOOK_URL_[A-Z0-9_]+$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readDeliveryTargetConfigs(
  raw = process.env.SCHEDULED_TASK_DELIVERY_TARGETS_JSON ?? "[]",
): DeliveryTargetConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SCHEDULED_TASK_DELIVERY_TARGETS_JSON 不是有效 JSON");
  }
  if (!Array.isArray(parsed))
    throw new Error("SCHEDULED_TASK_DELIVERY_TARGETS_JSON 必须是数组");

  const targets = parsed.map((item, index) => {
    const value = asRecord(item);
    if (value.type !== "FEISHU")
      throw new Error(`投递目标 ${index} 的 type 必须是 FEISHU`);
    if (
      typeof value.targetRef !== "string" ||
      !targetRefPattern.test(value.targetRef)
    )
      throw new Error(`投递目标 ${index} 的 targetRef 格式无效`);
    if (typeof value.name !== "string" || !value.name.trim())
      throw new Error(`投递目标 ${index} 缺少 name`);
    if (
      typeof value.secretEnvVar !== "string" ||
      !secretEnvVarPattern.test(value.secretEnvVar)
    )
      throw new Error(`投递目标 ${index} 的 secretEnvVar 格式无效`);
    return {
      type: "FEISHU" as const,
      targetRef: value.targetRef,
      name: value.name.trim(),
      secretEnvVar: value.secretEnvVar,
    };
  });
  if (
    new Set(targets.map((target) => target.targetRef)).size !== targets.length
  )
    throw new Error("投递目标 targetRef 不能重复");
  return targets;
}

export function listDeliveryTargets(): PublicDeliveryTarget[] {
  return readDeliveryTargetConfigs().map(
    ({ secretEnvVar: _, ...target }) => target,
  );
}

export function hasDeliveryTarget(type: "FEISHU", targetRef: string) {
  return readDeliveryTargetConfigs().some(
    (target) => target.type === type && target.targetRef === targetRef,
  );
}

export function resolveFeishuWebhook(
  targetRef: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const target = readDeliveryTargetConfigs().find(
    (item) => item.type === "FEISHU" && item.targetRef === targetRef,
  );
  if (!target) throw new Error(`FEISHU_TARGET_NOT_CONFIGURED: ${targetRef}`);
  const value = environment[target.secretEnvVar]?.trim();
  if (!value) throw new Error(`FEISHU_WEBHOOK_NOT_CONFIGURED: ${targetRef}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`FEISHU_WEBHOOK_INVALID: ${targetRef}`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "open.feishu.cn" ||
    !url.pathname.startsWith("/open-apis/bot/v2/hook/")
  )
    throw new Error(`FEISHU_WEBHOOK_INVALID: ${targetRef}`);
  return url.toString();
}

export function assertDeliveryTargetSecretsConfigured() {
  for (const target of readDeliveryTargetConfigs())
    resolveFeishuWebhook(target.targetRef);
}

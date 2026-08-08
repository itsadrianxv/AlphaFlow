import {
  FeishuDeliveryError,
  type FeishuDeliveryGuard,
} from "~/server/application/research-distribution/research-distribution-service";

/** @deprecated 仅保留旧测试/调用方兼容；正式 worker 不再使用 nested permit。 */
export class PostgresFeishuDeliveryGuard implements FeishuDeliveryGuard {
  constructor(
    private readonly scheduler: {
      acquireNestedPermit(
        input: Record<string, unknown>,
      ): Promise<{ id: string }>;
      releasePermit(
        id: string,
        holderId: string,
        fencingToken: bigint,
        reason: string,
      ): Promise<void>;
    },
    private readonly control: {
      getCircuit?: (
        poolId: string,
      ) => Promise<{ state: string; retryAfter?: Date | null }>;
      recordOutcome(
        poolId: string,
        outcome: { kind: "SUCCESS" },
      ): Promise<unknown>;
    },
    private readonly context: {
      taskId: string;
      resourcePoolId: string;
      holderId: string;
      fencingToken: bigint;
      permitKey: string;
    },
  ) {}

  async run(_copyId: string, operation: () => Promise<void>) {
    const circuit = this.control.getCircuit
      ? await this.control.getCircuit(this.context.resourcePoolId)
      : null;
    if (circuit?.state === "OPEN") {
      throw new FeishuDeliveryError("FEISHU_RESOURCE_UNAVAILABLE", true);
    }
    const permit = await this.scheduler.acquireNestedPermit({
      ...this.context,
    });
    try {
      await operation();
      await this.control.recordOutcome(this.context.resourcePoolId, {
        kind: "SUCCESS",
      });
    } finally {
      await this.scheduler.releasePermit(
        permit.id,
        this.context.holderId,
        this.context.fencingToken,
        "feishu_delivery_finished",
      );
    }
  }
}

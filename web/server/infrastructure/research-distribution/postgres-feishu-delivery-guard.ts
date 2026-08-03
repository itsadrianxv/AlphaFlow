import {
  FeishuDeliveryError,
  type FeishuDeliveryGuard,
} from "~/server/application/research-distribution/research-distribution-service";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { ResourcePermitUnavailableError } from "~/server/domain/scheduling/types";

export type FeishuDeliveryTaskContext = {
  taskId: string;
  resourcePoolId: string;
  holderId: string;
  fencingToken: bigint;
  permitKey: string;
};

export class PostgresFeishuDeliveryGuard implements FeishuDeliveryGuard {
  constructor(
    private readonly scheduler: PostgresResearchScheduler,
    private readonly context: FeishuDeliveryTaskContext,
  ) {}

  async run(_copyId: string, operation: () => Promise<void>) {
    try {
      await this.scheduler.acquireNestedPermit({
        taskId: this.context.taskId,
        resourcePoolId: this.context.resourcePoolId,
        holderId: this.context.holderId,
        fencingToken: this.context.fencingToken,
        permitKey: this.context.permitKey,
      });
    } catch (error) {
      if (!(error instanceof ResourcePermitUnavailableError)) throw error;
      const circuit = await this.scheduler.getCircuit(
        this.context.resourcePoolId,
      );
      throw new FeishuDeliveryError(
        circuit?.state === "CONFIG_BLOCKED"
          ? "FEISHU_RESOURCE_CONFIG_BLOCKED"
          : "FEISHU_RESOURCE_UNAVAILABLE",
        circuit?.state !== "CONFIG_BLOCKED",
        circuit?.retryAfter
          ? Math.max(0, circuit.retryAfter.getTime() - Date.now())
          : undefined,
      );
    }

    try {
      await operation();
      await this.scheduler.recordOutcome(this.context.resourcePoolId, {
        kind: "SUCCESS",
      });
    } catch (error) {
      const deliveryError = error instanceof FeishuDeliveryError ? error : null;
      await this.scheduler.recordOutcome(
        this.context.resourcePoolId,
        deliveryError?.code === "FEISHU_HTTP_429"
          ? {
              kind: "RATE_LIMITED",
              retryAfterMs: deliveryError.retryAfterMs,
            }
          : { kind: "FAILURE" },
      );
      throw error;
    }
  }
}

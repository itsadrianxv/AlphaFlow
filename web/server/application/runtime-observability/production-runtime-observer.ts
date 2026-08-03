import type { PrismaClient } from "@prisma/client";
import { RuntimeObservabilityService } from "~/server/application/runtime-observability/runtime-observability-service";
import type {
  DeliveryObservation,
  RuntimeMetricKind,
  RuntimeObservationContext,
  RuntimeUsage,
} from "~/server/domain/runtime-observability/types";
import { PrismaRuntimeObservabilityRepository } from "~/server/infrastructure/runtime-observability/prisma-runtime-observability-repository";

export type ProductionStageObservation = {
  idempotencyKey: string;
  metricKind?: RuntimeMetricKind;
  stage: string;
  resourcePool: string;
  startedAt: Date;
  readyAt: Date;
  success: boolean;
  degraded?: boolean;
  errorClass?: string | null;
  context: RuntimeObservationContext;
  usage?: RuntimeUsage;
  delivery?: DeliveryObservation;
};

export class ProductionRuntimeObserver {
  private readonly service: RuntimeObservabilityService;

  constructor(db: PrismaClient) {
    this.service = new RuntimeObservabilityService(
      new PrismaRuntimeObservabilityRepository(db),
    );
  }

  async record(input: ProductionStageObservation) {
    return this.service.record({
      idempotencyKey: input.idempotencyKey,
      metricKind: input.metricKind ?? "PROCESSING",
      stage: input.stage,
      resourcePool: input.resourcePool,
      productClockAt: input.startedAt,
      readyAt: input.readyAt,
      success: input.success,
      degraded: input.degraded,
      errorClass: input.errorClass,
      context: input.context,
      usage: input.usage,
      delivery: input.delivery,
    });
  }
}

import Redis from "ioredis";
import { env } from "~/env";
import type {
  QuickResearchGraphState,
  WorkflowStreamEvent,
} from "~/server/domain/workflow/types";

function getCheckpointKey(runId: string) {
  return `workflow:checkpoint:${runId}`;
}

function getRunEventChannel(runId: string) {
  return `workflow:run:${runId}:events`;
}

let publisherSingleton: Redis | null = null;

function getPublisherClient() {
  if (!publisherSingleton) {
    publisherSingleton = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  return publisherSingleton;
}

export class RedisWorkflowRuntimeStore {
  private readonly publisher: Redis;

  constructor() {
    this.publisher = getPublisherClient();
  }

  getCheckpointKey(runId: string) {
    return getCheckpointKey(runId);
  }

  getEventChannel(runId: string) {
    return getRunEventChannel(runId);
  }

  async saveCheckpoint(runId: string, state: QuickResearchGraphState) {
    await this.publisher.set(getCheckpointKey(runId), JSON.stringify(state));
  }

  async loadCheckpoint(runId: string): Promise<QuickResearchGraphState | null> {
    const raw = await this.publisher.get(getCheckpointKey(runId));

    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as QuickResearchGraphState;
  }

  async clearCheckpoint(runId: string) {
    await this.publisher.del(getCheckpointKey(runId));
  }

  async publishEvent(event: WorkflowStreamEvent) {
    await this.publisher.publish(
      getRunEventChannel(event.runId),
      JSON.stringify(event),
    );
  }

  async subscribeToRunEvents(
    runId: string,
    onEvent: (event: WorkflowStreamEvent) => void,
    signal?: AbortSignal,
  ) {
    const subscriber = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    await subscriber.subscribe(getRunEventChannel(runId));

    subscriber.on("message", (_channel, message) => {
      try {
        const parsed = JSON.parse(message) as WorkflowStreamEvent;
        onEvent(parsed);
      } catch {
        // Ignore malformed messages from external publishers.
      }
    });

    const close = async () => {
      subscriber.removeAllListeners("message");
      await subscriber.unsubscribe(getRunEventChannel(runId));
      await subscriber.quit();
    };

    if (signal) {
      signal.addEventListener("abort", () => {
        void close();
      });
    }

    return close;
  }
}

import type { MindMapSaveStatus } from "~/app/mind-maps/mind-map-model";

export type MindMapSaveQueueCallbacks<TSnapshot> = {
  getSnapshot: () => TSnapshot;
  save: (snapshot: TSnapshot) => Promise<void>;
  onStatus: (status: MindMapSaveStatus) => void;
  onError: (error: unknown) => void;
};

export class MindMapSaveQueue<TSnapshot> {
  private revision = 0;
  private savedRevision = 0;
  private running: Promise<void> | null = null;

  get hasPending() {
    return this.savedRevision < this.revision;
  }

  get isSaving() {
    return this.running !== null;
  }

  markChanged() {
    this.revision += 1;
  }

  flush(callbacks: MindMapSaveQueueCallbacks<TSnapshot>) {
    if (this.running) return this.running;
    this.running = this.drain(callbacks).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(callbacks: MindMapSaveQueueCallbacks<TSnapshot>) {
    while (this.savedRevision < this.revision) {
      const targetRevision = this.revision;
      callbacks.onStatus("saving");
      try {
        await callbacks.save(callbacks.getSnapshot());
        this.savedRevision = targetRevision;
      } catch (error) {
        callbacks.onError(error);
        callbacks.onStatus("error");
        return;
      }
    }
    callbacks.onStatus("saved");
  }
}

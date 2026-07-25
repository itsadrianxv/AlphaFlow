declare module "simple-mind-map" {
  type Listener = (...args: unknown[]) => void;
  class MindMap {
    constructor(options: Record<string, unknown>);
    getData(withConfig?: boolean): Record<string, unknown>;
    on(event: string, listener: Listener): void;
    off(event: string, listener: Listener): void;
    destroy(): void;
  }
  export default MindMap;
}

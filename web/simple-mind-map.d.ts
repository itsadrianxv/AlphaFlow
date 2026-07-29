declare module "simple-mind-map" {
  type Listener = (...args: unknown[]) => void;
  class MindMap {
    static usePlugin(plugin: unknown): typeof MindMap;
    constructor(options: Record<string, unknown>);
    getData(withConfig?: boolean): Record<string, unknown>;
    getTheme(): string;
    getLayout(): string;
    getCustomThemeConfig(): Record<string, unknown>;
    setTheme(theme: string): void;
    setThemeConfig(config: Record<string, unknown>, clear?: boolean): void;
    setLayout(layout: string): void;
    setFullData(data: Record<string, unknown>): void;
    updateConfig(config: Record<string, unknown>): void;
    execCommand(command: string, ...args: unknown[]): void;
    export(type: string, ...args: unknown[]): Promise<unknown>;
    resize(): void;
    renderer: {
      startTextEdit(): void;
      endTextEdit(): void;
      root?: unknown;
    };
    view: {
      scale: number;
      narrow(): void;
      enlarge(): void;
      fit(...args: unknown[]): void;
      reset(): void;
      setScale(scale: number): void;
    };
    search: {
      search(text?: string, callback?: () => void): void;
      searchNext(callback?: () => void, index?: number): void;
      searchPrev(callback?: () => void): void;
      endSearch(): void;
      matchNodeList: unknown[];
      currentIndex: number;
    };
    painter: { startPainter(): void };
    on(event: string, listener: Listener): void;
    off(event: string, listener: Listener): void;
    destroy(): void;
  }
  export default MindMap;
}

declare module "simple-mind-map/src/plugins/*.js" {
  const plugin: unknown;
  export default plugin;
}

declare module "simple-mind-map/src/parse/xmind.js" {
  const parser: {
    parseXmindFile(
      file: Blob,
      selectSheet?: (sheets: Array<{ title: string }>) => Promise<unknown>,
    ): Promise<Record<string, unknown>>;
  };
  export default parser;
}

declare module "simple-mind-map/src/parse/markdown.js" {
  const parser: {
    transformMarkdownTo(source: string): Record<string, unknown>;
  };
  export default parser;
}

declare module "simple-mind-map-plugin-themes" {
  const themes: { init(mindMap: unknown): void };
  export default themes;
}

declare module "simple-mind-map-plugin-themes/themeList" {
  const themes: Array<{
    name: string;
    value: string;
    dark?: boolean;
  }>;
  export default themes;
}

declare module "simple-mind-map-plugin-themes/themeImgMap" {
  const themeImages: Record<string, string>;
  export default themeImages;
}

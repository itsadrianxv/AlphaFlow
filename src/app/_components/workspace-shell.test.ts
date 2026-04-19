import { describe, expect, it } from "vitest";

import {
  DESKTOP_SIDEBAR_STORAGE_KEY,
  loadDesktopSidebarCollapsedState,
} from "~/app/_components/workspace-shell";

type StorageMap = Map<string, string>;
const legacyDesktopSidebarStorageKey = [
  "ssb",
  "workspaceShell",
  "desktopCollapsed",
].join(".");

function createStorage(initialEntries: Record<string, string> = {}) {
  const values: StorageMap = new Map(Object.entries(initialEntries));

  return {
    storage: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    },
    values,
  };
}

describe("loadDesktopSidebarCollapsedState", () => {
  it("prefers the AlphaFlow key when it already exists", () => {
    const { storage, values } = createStorage({
      [DESKTOP_SIDEBAR_STORAGE_KEY]: "true",
      [legacyDesktopSidebarStorageKey]: "false",
    });

    expect(loadDesktopSidebarCollapsedState(storage)).toBe(true);
    expect(values.get(DESKTOP_SIDEBAR_STORAGE_KEY)).toBe("true");
  });

  it("migrates the legacy SSB key into the AlphaFlow key", () => {
    const { storage, values } = createStorage({
      [legacyDesktopSidebarStorageKey]: "true",
    });

    expect(loadDesktopSidebarCollapsedState(storage)).toBe(true);
    expect(values.get(DESKTOP_SIDEBAR_STORAGE_KEY)).toBe("true");
  });
});

import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_STORAGE_KEY } from "~/app/_components/theme-provider";

describe("主题状态", () => {
  it("没有保存值或值无效时默认暗色", () => {
    expect(resolveTheme(null)).toBe("dark");
    expect(resolveTheme("system")).toBe("dark");
  });

  it("只接受暗色和浅色", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(THEME_STORAGE_KEY).toBe("ssb.theme");
  });
});

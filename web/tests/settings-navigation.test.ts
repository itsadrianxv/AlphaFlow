import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shellSource = readFileSync("app/_components/workspace-shell.tsx", "utf8");
const settingsSource = readFileSync("app/settings/settings-client.tsx", "utf8");
const radarPageSource = readFileSync("app/research-radar/page.tsx", "utf8");
const securityPageSource = readFileSync(
  "app/account/security/page.tsx",
  "utf8",
);

describe("设置页面导航归属", () => {
  it("将设置入口放在历史区域之后，并移除两个独立入口", () => {
    const historyIndex = shellSource.indexOf("{shouldShowHistory ?");
    const settingsIndex = shellSource.indexOf('href="/settings"');

    expect(historyIndex).toBeGreaterThanOrEqual(0);
    expect(settingsIndex).toBeGreaterThan(historyIndex);
    expect(shellSource).not.toContain('href: "/research-radar"');
    expect(shellSource).not.toContain('href: "/account/security"');
  });

  it("在设置页同时承载投研雷达和账号安全", () => {
    expect(settingsSource).toContain("<ResearchRadarPanel />");
    expect(settingsSource).toContain("账号安全");
    expect(settingsSource).toContain("<ChangePasswordForm />");
  });

  it("将亮色和暗色模式从侧边栏移动到设置页", () => {
    expect(shellSource).not.toContain("ThemeToggle");
    expect(shellSource).not.toContain("useTheme");
    expect(settingsSource).toContain("AppearanceSettings");
    expect(settingsSource).toContain('label: "亮色"');
    expect(settingsSource).toContain('label: "暗色"');
    expect(settingsSource).toContain("setTheme(option.value)");
    expect(settingsSource).toContain("aria-pressed={active}");
  });

  it("保留旧路径并跳转到设置页", () => {
    expect(radarPageSource).toContain('redirect("/settings")');
    expect(securityPageSource).toContain('redirect("/settings")');
  });
});

"use client";

import { MoonIcon, SunIcon } from "~/app/_components/sidebar-icons";
import { useTheme } from "~/app/_components/theme-provider";

export function LoginThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel = theme === "dark" ? "浅色主题" : "暗色主题";
  const Icon = theme === "dark" ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      aria-label={`切换至${nextThemeLabel}`}
      title={`切换至${nextThemeLabel}`}
      className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-panel-strong)]"
      onClick={toggleTheme}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

"use client";

import { Inbox, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, {
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useEffect,
  useState,
} from "react";

import {
  AgentRuntimeIcon,
  CloseIcon,
  CompanyResearchIcon,
  MenuIcon,
  MoonIcon,
  OverviewIcon,
  ScheduledTasksIcon,
  ScreeningIcon,
  SidebarToggleIcon,
  SunIcon,
  TimingIcon,
  WatchlistsIcon,
  WorkflowsIcon,
} from "~/app/_components/sidebar-icons";
import { useTheme } from "~/app/_components/theme-provider";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export const DESKTOP_SIDEBAR_STORAGE_KEY =
  "ssb.workspaceShell.desktopCollapsed";

const HISTORY_ITEM_LIMIT = 8;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type WorkspaceSection =
  | "home"
  | "agentRuntime"
  | "screening"
  | "workflows"
  | "timing"
  | "watchlists"
  | "companyResearch"
  | "researchInbox"
  | "researchRadar"
  | "researchTargets"
  | "mindMaps"
  | "scheduledTasks"
  | "account";

export type WorkspaceSectionView = "default" | "history";

export type WorkspaceHistoryItem = {
  id: string;
  title: string;
  href: string;
  activeMatchHref?: string;
};

type SidebarIcon = ComponentType<SVGProps<SVGSVGElement>>;

const sidebarNavItems: Array<{
  key: WorkspaceSection;
  href: string;
  label: string;
  icon: SidebarIcon;
}> = [
  {
    key: "home",
    href: "/",
    label: "概览",
    icon: OverviewIcon,
  },
  {
    key: "agentRuntime",
    href: "/agent-runtime",
    label: "投研智能体",
    icon: AgentRuntimeIcon,
  },
  {
    key: "screening",
    href: "/screening",
    label: "筛选",
    icon: ScreeningIcon,
  },
  {
    key: "workflows",
    href: "/workflows",
    label: "行业研究",
    icon: WorkflowsIcon,
  },
  {
    key: "companyResearch",
    href: "/company-research",
    label: "公司判断",
    icon: CompanyResearchIcon,
  },
  {
    key: "timing",
    href: "/timing",
    label: "择时研究",
    icon: TimingIcon,
  },
  {
    key: "researchInbox",
    href: "/research-inbox",
    label: "研究收件箱",
    icon: Inbox,
  },
  {
    key: "researchRadar",
    href: "/research-radar",
    label: "研究雷达",
    icon: Radar,
  },
  {
    key: "researchTargets",
    href: "/research-targets",
    label: "投研收藏",
    icon: WatchlistsIcon,
  },
  {
    key: "mindMaps",
    href: "/mind-maps",
    label: "思维导图",
    icon: WatchlistsIcon,
  },
  {
    key: "scheduledTasks",
    href: "/scheduled-tasks",
    label: "定时任务",
    icon: ScheduledTasksIcon,
  },
  {
    key: "account",
    href: "/account/security",
    label: "账号安全",
    icon: ShieldCheck,
  },
];

function SidebarBrand(props: { onNavigate?: () => void }) {
  const { onNavigate } = props;

  return (
    <Link href="/" className="flex min-w-0 items-center" onClick={onNavigate}>
      <div className="min-w-0 truncate text-sm font-medium text-[var(--app-text-strong)]">
        AlphaFlow
      </div>
    </Link>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextThemeLabel = theme === "dark" ? "浅色主题" : "暗色主题";
  const Icon = theme === "dark" ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      aria-label={`切换至${nextThemeLabel}`}
      title={`切换至${nextThemeLabel}`}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-panel-strong)]"
      onClick={toggleTheme}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

function SidebarLink(props: {
  href: string;
  label: string;
  icon: SidebarIcon;
  iconKey: string;
  active?: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const {
    href,
    label,
    icon: Icon,
    iconKey,
    active = false,
    collapsed = false,
    onNavigate,
  } = props;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={cn(
        "rounded-[10px] border text-sm font-medium transition-colors",
        collapsed
          ? "flex h-11 w-11 items-center justify-center"
          : "flex items-center gap-3 px-3 py-2.5",
        active
          ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
          : "border-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
      )}
    >
      <span
        data-sidebar-icon={iconKey}
        className="flex h-[18px] w-[18px] items-center justify-center text-current"
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span
        aria-hidden={collapsed}
        data-collapsed={collapsed ? "true" : "false"}
        className={cn(
          "app-sidebar-label-panel",
          collapsed ? "pointer-events-none max-w-0 flex-none" : "",
        )}
      >
        <span className="block w-full truncate">{label}</span>
      </span>
      {collapsed ? <span className="sr-only">{label}</span> : null}
    </Link>
  );
}

function SidebarHistoryShortcut(props: {
  href: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { href, active, onNavigate } = props;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-history-shortcut={active ? "active" : "idle"}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors",
        active
          ? "bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
          : "text-[var(--app-text-subtle)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
      )}
    >
      &gt;
    </Link>
  );
}

function SidebarHistorySkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={`history-skeleton-${index + 1}`}
          className="h-9 rounded-[10px] bg-[var(--app-bg-raised)]"
        />
      ))}
    </div>
  );
}

function SidebarHistoryList(props: {
  heading: string;
  items: WorkspaceHistoryItem[];
  historyHref?: string;
  activeHistoryId?: string;
  historyItemLimit?: number;
  historyLoading?: boolean;
  historyEmptyText?: string;
  sectionView: WorkspaceSectionView;
  onNavigate?: () => void;
}) {
  const {
    heading,
    items,
    historyHref,
    activeHistoryId,
    historyItemLimit = HISTORY_ITEM_LIMIT,
    historyLoading = false,
    historyEmptyText,
    sectionView,
    onNavigate,
  } = props;
  const recentItems = items.slice(0, historyItemLimit);

  return (
    <section className="app-sidebar-history mt-auto min-w-0 overflow-hidden border-t border-[var(--app-border-soft)] pt-5">
      <div className="flex items-center justify-between gap-3 px-3 pb-2">
        <div className="text-[11px] font-medium tracking-[0.08em] text-[var(--app-text-subtle)]">
          {heading}
        </div>
        {historyHref ? (
          <SidebarHistoryShortcut
            href={historyHref}
            active={sectionView === "history"}
            onNavigate={onNavigate}
          />
        ) : null}
      </div>

      {historyLoading ? <SidebarHistorySkeleton /> : null}

      {!historyLoading && recentItems.length > 0 ? (
        <div className="grid min-w-0 gap-1">
          {recentItems.map((item) => {
            const active = item.id === activeHistoryId;

            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={item.title}
                className={cn(
                  "block w-full min-w-0 overflow-hidden rounded-[10px] px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
                    : "text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
                )}
              >
                <span className="block w-full truncate">{item.title}</span>
              </Link>
            );
          })}
        </div>
      ) : null}

      {!historyLoading && recentItems.length === 0 ? (
        <p className="px-3 py-2 text-sm text-[var(--app-text-subtle)]">
          {historyEmptyText}
        </p>
      ) : null}
    </section>
  );
}

function SidebarRail(props: {
  section: WorkspaceSection;
  sectionView: WorkspaceSectionView;
  navMode: "desktop" | "mobile";
  collapsed?: boolean;
  showHistory?: boolean;
  historyHeading: string;
  historyItems: WorkspaceHistoryItem[];
  historyHref?: string;
  activeHistoryId?: string;
  historyItemLimit?: number;
  historyLoading?: boolean;
  historyEmptyText?: string;
  onNavigate?: () => void;
  onToggleSidebar?: () => void;
}) {
  const {
    section,
    sectionView,
    navMode,
    collapsed = false,
    showHistory = true,
    historyHeading,
    historyItems,
    historyHref,
    activeHistoryId,
    historyItemLimit,
    historyLoading,
    historyEmptyText,
    onNavigate,
    onToggleSidebar,
  } = props;
  const shouldShowHistory =
    showHistory &&
    !collapsed &&
    (historyLoading ||
      historyItems.length > 0 ||
      Boolean(historyHref) ||
      Boolean(historyEmptyText));

  return (
    <div
      className={cn(
        "flex h-full flex-col",
        collapsed ? "items-center gap-4" : "gap-6",
      )}
      data-sidebar-collapsed={collapsed ? "true" : "false"}
    >
      {navMode === "desktop" ? (
        <div
          className={cn(
            "flex items-center",
            collapsed ? "justify-center" : "justify-between gap-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div
              aria-hidden={collapsed}
              data-collapsed={collapsed ? "true" : "false"}
              className={cn(
                "app-sidebar-brand-panel",
                collapsed ? "pointer-events-none max-w-0 flex-none" : "",
              )}
            >
              <SidebarBrand onNavigate={onNavigate} />
            </div>
            {section === "agentRuntime" ? (
              <Link
                href="/agent-runtime"
                onClick={onNavigate}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--app-border-soft)] px-3 text-xs font-medium text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-hover-border)] hover:bg-[var(--app-panel-strong)] hover:text-[var(--app-text-strong)]"
              >
                新对话
              </Link>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              aria-label="切换侧边栏"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-panel-strong)]"
              onClick={onToggleSidebar}
            >
              <span
                className="app-sidebar-toggle-icon"
                data-collapsed={collapsed ? "true" : "false"}
              >
                <SidebarToggleIcon className="h-[18px] w-[18px]" />
              </span>
            </button>
          </div>
        </div>
      ) : null}

      <nav
        className={cn("grid gap-1", collapsed ? "justify-items-center" : "")}
        data-sidebar-nav={navMode}
        aria-label="Sidebar navigation"
      >
        {sidebarNavItems.map((item) => (
          <SidebarLink
            key={item.key}
            href={item.href}
            label={item.label}
            icon={item.icon}
            iconKey={item.key}
            active={item.key === section}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {shouldShowHistory ? (
        <SidebarHistoryList
          heading={historyHeading}
          items={historyItems}
          historyHref={historyHref}
          activeHistoryId={activeHistoryId}
          historyItemLimit={historyItemLimit}
          historyLoading={historyLoading}
          historyEmptyText={historyEmptyText}
          sectionView={sectionView}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

function PageHeader(props: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  titleSize?: "default" | "compact";
}) {
  const { title, description, actions, titleSize = "default" } = props;
  const titleClassName =
    titleSize === "compact"
      ? "app-display max-w-5xl text-[38px] leading-[0.98] text-[var(--app-text-strong)] sm:text-[46px] xl:text-[58px]"
      : "app-display max-w-5xl text-[46px] leading-[0.96] text-[var(--app-text-strong)] sm:text-[58px] xl:text-[72px]";

  return (
    <header className="app-page-header flex flex-col gap-5 border-b border-[var(--app-border-soft)] pb-6 lg:flex-row lg:items-start lg:justify-between">
      {title || description ? (
        <div className="min-w-0">
          {title ? <h1 className={titleClassName}>{title}</h1> : null}
          {description ? (
            <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--app-text-muted)] sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}
      {actions ? (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function WorkspaceShell(props: {
  section: WorkspaceSection;
  sectionView?: WorkspaceSectionView;
  title?: string;
  description?: string;
  actions?: ReactNode;
  showWatchlistsAction?: boolean;
  showHistory?: boolean;
  summary?: ReactNode;
  workflowTabs?: WorkflowStageTab[];
  historyItems?: WorkspaceHistoryItem[];
  historyHeading?: string;
  historyHref?: string;
  activeHistoryId?: string;
  historyItemLimit?: number;
  historyLoading?: boolean;
  historyEmptyText?: string;
  initialDesktopCollapsed?: boolean;
  contentWidth?: "standard" | "wide";
  contentMode?: "default" | "editor";
  titleSize?: "default" | "compact";
  children: ReactNode;
}) {
  const {
    section,
    sectionView = "default",
    title,
    description,
    actions,
    summary,
    workflowTabs = [],
    historyItems = [],
    historyHeading = "历史",
    historyHref,
    activeHistoryId,
    historyItemLimit,
    historyLoading = false,
    historyEmptyText = "暂无历史记录",
    showHistory = true,
    initialDesktopCollapsed,
    contentWidth = "standard",
    contentMode = "default",
    titleSize = "default",
    children,
  } = props;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(
    initialDesktopCollapsed ?? false,
  );
  const [desktopStateReady, setDesktopStateReady] = useState(
    initialDesktopCollapsed !== undefined,
  );

  useEffect(() => {
    if (initialDesktopCollapsed !== undefined || desktopStateReady) {
      return;
    }

    const storedValue = window.localStorage.getItem(
      DESKTOP_SIDEBAR_STORAGE_KEY,
    );
    if (storedValue === "true") {
      setDesktopCollapsed(true);
    }
    setDesktopStateReady(true);
  }, [desktopStateReady, initialDesktopCollapsed]);

  useEffect(() => {
    if (!desktopStateReady) {
      return;
    }

    window.localStorage.setItem(
      DESKTOP_SIDEBAR_STORAGE_KEY,
      desktopCollapsed ? "true" : "false",
    );
  }, [desktopCollapsed, desktopStateReady]);
  const shouldShowPageHeader = Boolean(title || description || actions);

  return (
    <main
      className={cn(
        "app-shell app-sidebar-shell min-h-screen bg-[var(--app-bg)] lg:grid",
        desktopCollapsed
          ? "lg:grid-cols-[88px_minmax(0,1fr)]"
          : "lg:grid-cols-[258px_minmax(0,1fr)]",
      )}
      data-workflow-shell="mistral"
      data-sidebar-collapsed={desktopCollapsed ? "true" : "false"}
    >
      <aside
        data-sidebar-anchor="left"
        className="hidden border-r border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] lg:block"
      >
        <div
          className={cn(
            "sticky top-0 h-screen py-4",
            desktopCollapsed ? "px-3" : "px-4",
          )}
        >
          <SidebarRail
            section={section}
            sectionView={sectionView}
            navMode="desktop"
            collapsed={desktopCollapsed}
            showHistory={showHistory}
            historyHeading={historyHeading}
            historyItems={historyItems}
            historyHref={historyHref}
            activeHistoryId={activeHistoryId}
            historyItemLimit={historyItemLimit}
            historyLoading={historyLoading}
            historyEmptyText={historyEmptyText}
            onToggleSidebar={() => setDesktopCollapsed((current) => !current)}
          />
        </div>
      </aside>

      <section className="min-w-0 bg-[var(--app-bg)]">
        <div className="border-b border-[var(--app-border-soft)] bg-[var(--app-bg)] lg:hidden">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              aria-label="Open navigation menu"
              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-panel-strong)]"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon className="h-[18px] w-[18px]" />
            </button>
            <SidebarBrand />
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0 bg-[var(--app-overlay)]"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative z-10 flex h-full w-[280px] max-w-[82vw] flex-col border-r border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] px-4 py-4 shadow-[var(--app-shadow-lg)]">
              <div className="mb-6 flex items-center justify-between gap-3">
                <SidebarBrand onNavigate={() => setMobileOpen(false)} />
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-sidebar-bg)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-panel-strong)]"
                  onClick={() => setMobileOpen(false)}
                >
                  <CloseIcon className="h-[18px] w-[18px]" />
                </button>
              </div>
              <SidebarRail
                section={section}
                sectionView={sectionView}
                navMode="mobile"
                showHistory={showHistory}
                historyHeading={historyHeading}
                historyItems={historyItems}
                historyHref={historyHref}
                activeHistoryId={activeHistoryId}
                historyItemLimit={historyItemLimit}
                historyLoading={historyLoading}
                historyEmptyText={historyEmptyText}
                onNavigate={() => setMobileOpen(false)}
              />
            </aside>
          </div>
        ) : null}

        <div
          className={cn(
            "mx-auto flex min-h-screen w-full flex-col",
            contentMode === "editor"
              ? "max-w-none gap-4 px-3 py-3 sm:px-4 lg:px-5 lg:py-4"
              : "gap-8 px-4 py-5 sm:px-6 lg:px-10 lg:py-8",
            contentMode !== "editor" &&
              (contentWidth === "wide" ? "max-w-[1560px]" : "max-w-[1280px]"),
          )}
        >
          {shouldShowPageHeader ? (
            <PageHeader
              title={title}
              description={description}
              actions={actions}
              titleSize={titleSize}
            />
          ) : null}

          {workflowTabs.length > 0 ? (
            <section className="grid gap-3 lg:grid-cols-4 xl:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
              {workflowTabs.map((tab, tabIndex) => (
                <article
                  key={tab.id}
                  className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-4 py-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-[family-name:var(--font-heading)] text-[11px] tracking-[0.14em] text-[var(--app-text-subtle)]">
                      Step {tabIndex + 1}
                    </div>
                    <div className="app-workflow-index">
                      {String(tabIndex + 1).padStart(2, "0")}
                    </div>
                  </div>
                  <div className="mt-3 font-[family-name:var(--font-heading)] text-xl leading-none text-[var(--app-text-strong)]">
                    {tab.label}
                  </div>
                  <div className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                    {tab.summary}
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {summary ? (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summary}
            </section>
          ) : null}

          <div
            className={cn(
              "grid",
              contentMode === "editor" ? "min-h-0 flex-1 gap-0" : "gap-6",
            )}
          >
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}

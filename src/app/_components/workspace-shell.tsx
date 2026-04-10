"use client";

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
  CloseIcon,
  CompanyResearchIcon,
  MenuIcon,
  OverviewIcon,
  ScreeningIcon,
  SidebarToggleIcon,
  TimingIcon,
  WorkflowsIcon,
} from "~/app/_components/sidebar-icons";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";

export const DESKTOP_SIDEBAR_STORAGE_KEY =
  "ssb.workspaceShell.desktopCollapsed";

const HISTORY_ITEM_LIMIT = 8;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type WorkspaceSection =
  | "home"
  | "screening"
  | "workflows"
  | "timing"
  | "companyResearch";

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
    label: "择时组合",
    icon: TimingIcon,
  },
];

function AppMark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-panel-strong)] font-[family-name:var(--font-heading)] text-[11px] tracking-[0.12em] text-[var(--app-text-strong)]">
      SSB
    </div>
  );
}

function SidebarBrand(props: { onNavigate?: () => void }) {
  const { onNavigate } = props;

  return (
    <Link href="/" className="flex items-center gap-3" onClick={onNavigate}>
      <AppMark />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[var(--app-text-strong)]">
          Stock Screening Boost
        </div>
        <div className="text-xs text-[var(--app-text-subtle)]">
          投资决策工作台
        </div>
      </div>
    </Link>
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
      {collapsed ? <span className="sr-only">{label}</span> : null}
      {!collapsed ? <span className="truncate">{label}</span> : null}
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
    historyLoading = false,
    historyEmptyText = "暂无历史记录",
    sectionView,
    onNavigate,
  } = props;
  const recentItems = items.slice(0, HISTORY_ITEM_LIMIT);

  return (
    <section className="mt-auto border-t border-[var(--app-border-soft)] pt-5">
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
        <div className="grid gap-1">
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
                  "block rounded-[10px] px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
                    : "text-[var(--app-text-muted)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
                )}
              >
                <span className="block truncate">{item.title}</span>
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
  historyHeading: string;
  historyItems: WorkspaceHistoryItem[];
  historyHref?: string;
  activeHistoryId?: string;
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
    historyHeading,
    historyItems,
    historyHref,
    activeHistoryId,
    historyLoading,
    historyEmptyText,
    onNavigate,
    onToggleSidebar,
  } = props;
  const shouldShowHistory =
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
          {!collapsed ? <SidebarBrand onNavigate={onNavigate} /> : null}
          <button
            type="button"
            aria-label="Toggle sidebar"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-bg-raised)]"
            onClick={onToggleSidebar}
          >
            <SidebarToggleIcon className="h-[18px] w-[18px]" />
          </button>
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
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { eyebrow, title, description, actions } = props;

  return (
    <header className="app-page-header flex flex-col gap-5 border-b border-[var(--app-border-soft)] pb-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-4 font-[family-name:var(--font-heading)] text-[11px] tracking-[0.18em] text-[var(--app-text-subtle)]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="app-display max-w-5xl text-[46px] leading-[0.96] text-[var(--app-text-strong)] sm:text-[58px] xl:text-[72px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-4 max-w-4xl text-sm leading-7 text-[var(--app-text-muted)] sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function WorkspaceShell(props: {
  section: WorkspaceSection;
  sectionView?: WorkspaceSectionView;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  workflowTabs?: WorkflowStageTab[];
  historyItems?: WorkspaceHistoryItem[];
  historyHeading?: string;
  historyHref?: string;
  activeHistoryId?: string;
  historyLoading?: boolean;
  historyEmptyText?: string;
  initialDesktopCollapsed?: boolean;
  children: ReactNode;
}) {
  const {
    section,
    sectionView = "default",
    eyebrow,
    title,
    description,
    actions,
    summary,
    workflowTabs = [],
    historyItems = [],
    historyHeading = "历史",
    historyHref,
    activeHistoryId,
    historyLoading = false,
    historyEmptyText = "暂无历史记录",
    initialDesktopCollapsed,
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

  return (
    <main
      className={cn(
        "app-shell min-h-screen bg-[var(--app-bg)] lg:grid",
        desktopCollapsed
          ? "lg:grid-cols-[88px_minmax(0,1fr)]"
          : "lg:grid-cols-[258px_minmax(0,1fr)]",
      )}
      data-workflow-shell="mistral"
      data-sidebar-collapsed={desktopCollapsed ? "true" : "false"}
    >
      <aside
        data-sidebar-anchor="left"
        className="hidden border-r border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] lg:block"
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
            historyHeading={historyHeading}
            historyItems={historyItems}
            historyHref={historyHref}
            activeHistoryId={activeHistoryId}
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
              className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-bg-raised)]"
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon className="h-[18px] w-[18px]" />
            </button>
            <SidebarBrand />
          </div>
        </div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0 bg-[rgba(0,0,0,0.72)]"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="relative z-10 flex h-full w-[280px] max-w-[82vw] flex-col border-r border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] px-4 py-4 shadow-[var(--app-shadow-lg)]">
              <div className="mb-6 flex items-center justify-between gap-3">
                <SidebarBrand onNavigate={() => setMobileOpen(false)} />
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] text-[var(--app-text-strong)] transition-colors hover:bg-[var(--app-bg-raised)]"
                  onClick={() => setMobileOpen(false)}
                >
                  <CloseIcon className="h-[18px] w-[18px]" />
                </button>
              </div>
              <SidebarRail
                section={section}
                sectionView={sectionView}
                navMode="mobile"
                historyHeading={historyHeading}
                historyItems={historyItems}
                historyHref={historyHref}
                activeHistoryId={activeHistoryId}
                historyLoading={historyLoading}
                historyEmptyText={historyEmptyText}
                onNavigate={() => setMobileOpen(false)}
              />
            </aside>
          </div>
        ) : null}

        <div className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col gap-8 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <PageHeader
            eyebrow={eyebrow}
            title={title}
            description={description}
            actions={actions}
          />

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

          <div className="grid gap-6">{children}</div>
        </div>
      </section>
    </main>
  );
}

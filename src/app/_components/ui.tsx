"use client";

import Link from "next/link";
import React, { type ReactNode } from "react";

import { AlphaFlowMark } from "~/app/_components/brand/alpha-flow-mark";
import {
  primaryWorkflowStages,
  type WorkflowStageTab,
} from "~/app/_components/workflow-stage-config";

export {
  DESKTOP_SIDEBAR_STORAGE_KEY,
  type WorkspaceHistoryItem,
  type WorkspaceSection,
  type WorkspaceSectionView,
  WorkspaceShell,
} from "~/app/_components/workspace-shell";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export type Surface = "base" | "raised" | "floating" | "inset";
export type Density = "comfortable" | "compact";
export type Emphasis = "normal" | "strong";
export type Interactive = boolean;

type WorkspaceSection =
  | "home"
  | "screening"
  | "workflows"
  | "timing"
  | "companyResearch";

type WorkspaceSectionView = "default" | "history";

const navItems: Array<{
  key: WorkspaceSection;
  href: string;
  label: string;
  detail: string;
}> = [
  {
    key: "home",
    href: "/",
    label: "总览",
    detail: "今日决策与运行状态",
  },
  {
    key: "screening",
    href: "/screening",
    label: "股票筛选",
    detail: "策略、会话与观察池",
  },
  {
    key: "workflows",
    href: "/workflows",
    label: "行业研究",
    detail: "行业逻辑与研究运行",
  },
  {
    key: "companyResearch",
    href: "/company-research",
    label: "公司研究",
    detail: "公司判断与证据跟踪",
  },
  {
    key: "timing",
    href: "/timing",
    label: "择时组合",
    detail: "组合建议与复盘闭环",
  },
];

const sidebarNavItems: Array<{
  key: WorkspaceSection;
  href: string;
  label: string;
  detail: string;
  historyHref?: string;
  historyLabel?: string;
}> = [
  {
    key: "home",
    href: "/",
    label: "\u6982\u89c8",
    detail: "\u4eca\u65e5\u51b3\u7b56\u4e0e\u8fd0\u884c\u72b6\u6001",
  },
  {
    key: "screening",
    href: "/screening",
    label: "\u7b5b\u9009",
    detail: "\u7b56\u7565\u3001\u4f1a\u8bdd\u4e0e\u89c2\u5bdf\u6c60",
    historyHref: "/screening/history",
    historyLabel: "\u7b5b\u9009\u5386\u53f2",
  },
  {
    key: "workflows",
    href: "/workflows",
    label: "\u884c\u4e1a\u7814\u7a76",
    detail: "\u884c\u4e1a\u903b\u8f91\u4e0e\u7814\u7a76\u8fd0\u884c",
    historyHref: "/workflows/history",
    historyLabel: "\u884c\u4e1a\u7814\u7a76\u5386\u53f2",
  },
  {
    key: "companyResearch",
    href: "/company-research",
    label: "\u516c\u53f8\u5224\u65ad",
    detail: "\u516c\u53f8\u5224\u65ad\u4e0e\u8bc1\u636e\u8ddf\u8e2a",
    historyHref: "/company-research/history",
    historyLabel: "\u516c\u53f8\u5224\u65ad\u5386\u53f2",
  },
  {
    key: "timing",
    href: "/timing",
    label: "\u62e9\u65f6\u7ec4\u5408",
    detail: "\u7ec4\u5408\u5efa\u8bae\u4e0e\u590d\u76d8\u95ed\u73af",
    historyHref: "/timing/history",
    historyLabel: "\u62e9\u65f6\u7ec4\u5408\u5386\u53f2",
  },
];

const toneClassMap: Record<Tone, string> = {
  neutral:
    "border-[var(--app-neutral-border)] bg-[var(--app-neutral-surface)] text-[var(--app-text-muted)]",
  info: "border-[var(--app-info-border)] bg-[var(--app-info-surface)] text-[var(--app-text-strong)]",
  success:
    "border-[var(--app-success-border)] bg-[var(--app-success-surface)] text-[var(--app-text-strong)]",
  warning:
    "border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] text-[var(--app-text-strong)]",
  danger:
    "border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] text-[var(--app-danger)]",
};

const surfaceClassMap: Record<Surface, string> = {
  base: "bg-[var(--app-surface)]",
  inset: "bg-[var(--app-surface)] border border-[var(--app-border-soft)]",
  raised: "glass-panel",
  floating: "glass-panel shadow-[var(--app-shadow-lg)]",
};

const densityClassMap: Record<Density, string> = {
  comfortable: "p-5 sm:p-6",
  compact: "p-4",
};

export function PageHeader(props: {
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

export function LegacyWorkspaceShell(props: {
  section: WorkspaceSection;
  sectionView?: WorkspaceSectionView;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  workflowTabs?: WorkflowStageTab[];
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
    children,
  } = props;
  const sidebarActiveItem = sidebarNavItems.find(
    (item) => item.key === section,
  );
  const contextualHistory =
    sidebarActiveItem?.historyHref && sidebarActiveItem.historyLabel
      ? {
          href: sidebarActiveItem.historyHref,
          label: sidebarActiveItem.historyLabel,
        }
      : null;

  if (sectionView === "default" || sectionView === "history") {
    return (
      <main className="app-shell" data-workflow-shell="mistral">
        <div className="mx-auto min-h-screen w-full max-w-[1520px] lg:grid lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] lg:min-h-screen lg:border-r lg:border-b-0">
            <div className="flex h-full flex-col gap-6 px-4 py-5 sm:px-6 lg:sticky lg:top-0 lg:h-screen lg:px-5">
              <Link href="/" className="flex items-center gap-3">
                <AlphaFlowMark />
                <div>
                  <div className="font-[family-name:var(--font-heading)] text-sm font-medium text-[var(--app-text-strong)]">
                    AlphaFlow
                  </div>
                  <div className="text-xs text-[var(--app-text-subtle)]">
                    {"\u6295\u8d44\u51b3\u7b56\u5de5\u4f5c\u53f0"}
                  </div>
                </div>
              </Link>

              <nav className="grid gap-2" aria-label="Sidebar navigation">
                {sidebarNavItems.map((item) => {
                  const active = item.key === section;

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "rounded-[12px] border px-3 py-3 transition-colors",
                        active
                          ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
                          : "border-transparent text-[var(--app-text-muted)] hover:border-[var(--app-border-soft)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
                      )}
                    >
                      <div className="font-[family-name:var(--font-heading)] text-sm font-medium">
                        {item.label}
                      </div>
                      <div className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">
                        {item.detail}
                      </div>
                    </Link>
                  );
                })}
              </nav>

              {contextualHistory ? (
                <section className="grid gap-3 border-t border-[var(--app-border-soft)] pt-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                    {"\u5386\u53f2\u5165\u53e3"}
                  </div>
                  <Link
                    href={contextualHistory.href}
                    aria-current={
                      sectionView === "history" ? "page" : undefined
                    }
                    className={cn(
                      "rounded-[12px] border px-3 py-3 transition-colors",
                      sectionView === "history"
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] text-[var(--app-text-strong)]"
                        : "border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]",
                    )}
                  >
                    <div className="font-[family-name:var(--font-heading)] text-sm font-medium">
                      {contextualHistory.label}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">
                      {
                        "\u67e5\u770b\u5f53\u524d\u6a21\u5757\u7684\u5386\u53f2\u8bb0\u5f55\u4e0e\u56de\u6eaf\u5165\u53e3"
                      }
                    </div>
                  </Link>
                </section>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto flex min-h-screen w-full max-w-[1260px] flex-col gap-8">
              <PageHeader
                eyebrow={eyebrow}
                title={title}
                description={description}
                actions={actions}
              />

              {workflowTabs && workflowTabs.length > 0 ? (
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
        </div>
      </main>
    );
  }
  const activeItem = navItems.find((item) => item.key === section);
  const activeStageId = section === "home" ? null : section;
  const primaryNavigation = (
    <nav
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
      aria-label="Primary navigation"
    >
      {primaryWorkflowStages.map((stage) => {
        const active = activeStageId === stage.id;

        return (
          <Link
            key={stage.id}
            href={stage.href}
            className={cn(
              "border-b-2 border-transparent pb-1 text-[15px] font-medium transition-colors",
              active
                ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
                : "text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]",
            )}
          >
            {stage.label}
          </Link>
        );
      })}
    </nav>
  );
  const historyNavigation = (
    <nav
      className="flex flex-wrap items-center gap-2"
      aria-label="History navigation"
    >
      <Link
        href="/screening/history"
        className="border border-[var(--app-border-soft)] px-3 py-2 text-[13px] text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
      >
        {"\u7b5b\u9009\u6863\u6848"}
      </Link>
      <Link
        href="/workflows/history"
        className="border border-[var(--app-border-soft)] px-3 py-2 text-[13px] text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
      >
        {"\u7814\u7a76\u6863\u6848"}
      </Link>
      <Link
        href="/timing/history"
        className="border border-[var(--app-border-soft)] px-3 py-2 text-[13px] text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
      >
        {"\u7ec4\u5408\u590d\u76d8"}
      </Link>
    </nav>
  );

  if ((section as string) !== "__legacy_sidebar__") {
    return (
      <main className="app-shell" data-workflow-shell="mistral">
        <header className="sticky top-0 z-20 border-b border-[var(--app-border-soft)] bg-[rgba(0,0,0,0.9)] backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {primaryNavigation}
              {historyNavigation}
            </div>
            {/*
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {false ? (
              <Link href="/" className="flex items-center gap-4">
              <AlphaFlowMark />
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--app-text-subtle)]">
                  AlphaFlow
                </div>
                <div className="mt-2 text-xl leading-none text-[var(--app-text-strong)]">
                  投资决策工作流
                </div>
              </div>
              </Link>
            ) : (
              primaryNavigation
            )}
            {false ? (
              <div className="flex flex-wrap gap-2">
              <Link href="/screening/history" className="app-button">
                筛选档案
              </Link>
              <Link href="/workflows/history" className="app-button">
                研究档案
              </Link>
              <Link href="/timing/history" className="app-button">
                组合复盘
              </Link>
              </div>
            ) : (
              historyNavigation
            )}
          </div>

          {false ? (
            <nav
            className="grid gap-3 lg:grid-cols-4"
            aria-label="Primary workflow"
          >
            {primaryWorkflowStages.map((stage, index) => {
              const active = activeStageId === stage.id;

              return (
                <Link
                  key={stage.id}
                  href={stage.href}
                  data-stage-active={active}
                  className={cn(
                    "border border-[var(--app-border-soft)] bg-[var(--app-bg)] px-4 py-4 transition-colors",
                    active
                      ? "border-[var(--app-brand)] bg-[var(--app-surface-strong)] text-[var(--app-text-strong)]"
                      : "text-[var(--app-text-muted)] hover:border-[var(--app-flame)] hover:text-[var(--app-text-strong)]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                      {stage.id}
                    </span>
                    <span className="app-workflow-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-3 text-[24px] leading-none text-[var(--app-text-strong)]">
                    {stage.label}
                  </div>
                  <div className="mt-3 text-sm leading-6">{stage.summary}</div>
                </Link>
              );
            })}
            </nav>
          ) : null}
          */}
          </div>
        </header>

        <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-8">
            <PageHeader
              eyebrow={eyebrow}
              title={title}
              description={description}
              actions={actions}
            />

            {workflowTabs && workflowTabs.length > 0 ? (
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

  if ((section as string) === "__legacy_sidebar__") {
    return (
      <main className="app-shell">
        <div className="mx-auto min-h-screen w-full max-w-[1520px] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="border-b border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] lg:min-h-screen lg:border-r lg:border-b-0">
            <div className="flex h-full flex-col gap-6 px-4 py-5 sm:px-6 lg:px-5">
              <Link href="/" className="flex items-center gap-3">
                <AlphaFlowMark />
                <div>
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    AlphaFlow
                  </div>
                  <div className="text-xs text-[var(--app-text-subtle)]">
                    投资决策工作台
                  </div>
                </div>
              </Link>

              <nav className="grid gap-1">
                {navItems.map((item) => {
                  const active = item.key === section;

                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={cn(
                        "rounded-[10px] border px-3 py-3 transition-colors",
                        active
                          ? "border-[var(--app-border-strong)] bg-[var(--app-bg-floating)] text-[var(--app-text-strong)]"
                          : "border-transparent text-[var(--app-text-muted)] hover:border-[var(--app-border-soft)] hover:bg-[var(--app-bg-raised)] hover:text-[var(--app-text-strong)]",
                      )}
                    >
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="mt-1 text-xs leading-5 text-[var(--app-text-subtle)]">
                        {item.detail}
                      </div>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-auto grid gap-3">
                <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] p-4">
                  <div className="text-xs text-[var(--app-text-subtle)]">
                    当前模块
                  </div>
                  <div className="mt-2 text-sm font-medium text-[var(--app-text-strong)]">
                    {activeItem?.label ?? "研究工作台"}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                    {activeItem?.detail ?? "统一查看研究、筛选与组合状态。"}
                  </div>
                </div>

                <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] p-4">
                  <div className="text-xs text-[var(--app-text-subtle)]">
                    快捷入口
                  </div>
                  <div className="mt-3 grid gap-2 text-sm">
                    <Link
                      href="/screening/history"
                      className="text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                    >
                      查看筛选历史
                    </Link>
                    <Link
                      href="/workflows/history"
                      className="text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                    >
                      查看研究历史
                    </Link>
                    <Link
                      href="/timing/history"
                      className="text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
                    >
                      查看组合复盘
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto flex min-h-screen w-full max-w-[1260px] flex-col gap-6">
              <PageHeader
                title={title}
                description={description}
                actions={actions}
              />

              {summary ? (
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {summary}
                </section>
              ) : null}

              <div className="grid gap-6">{children}</div>
            </div>
          </section>
        </div>
      </main>
    );
  }
}

export function SectionCard(props: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  surface?: Surface;
  density?: Density;
  emphasis?: Emphasis;
  interactive?: Interactive;
}) {
  const {
    title,
    description,
    actions,
    className,
    children,
    surface = "raised",
    density = "comfortable",
    emphasis = "normal",
    interactive = false,
  } = props;

  return (
    <section
      className={cn(
        "rounded-[16px] border border-[var(--app-border-soft)] shadow-[var(--app-shadow-sm)]",
        surfaceClassMap[surface],
        densityClassMap[density],
        emphasis === "strong" && "border-[var(--app-border-strong)]",
        interactive &&
          "transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-bg-floating)]",
        className,
      )}
    >
      {title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-[family-name:var(--font-heading)] text-[20px] leading-7 text-[var(--app-text-strong)]">
                {title}
              </h2>
            ) : null}
            {description ? (
              typeof description === "string" ||
              typeof description === "number" ? (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
                  {description}
                </p>
              ) : (
                <div className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
                  {description}
                </div>
              )
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn(title || description || actions ? "mt-5" : undefined)}>
        {children}
      </div>
    </section>
  );
}

export function Panel(props: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  surface?: Surface;
  density?: Density;
}) {
  return <SectionCard {...props} />;
}

export function MetricTile(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  surface?: Surface;
}) {
  const { label, value, hint, tone = "neutral", surface = "raised" } = props;

  return (
    <SectionCard
      surface={surface}
      density="compact"
      className="min-h-[124px] transition-all hover:bg-[var(--app-bg-elevated)]"
      description={
        hint ? (
          <span className="text-xs leading-5 text-[var(--app-text-muted)]">
            {hint}
          </span>
        ) : undefined
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
            {label}
          </div>
          <div className="app-data mt-3 text-[32px] leading-none text-[var(--app-text-strong)] tracking-tight">
            {value}
          </div>
        </div>
        <StatusPill
          label={
            tone === "success"
              ? "积极"
              : tone === "warning"
                ? "关注"
                : tone === "danger"
                  ? "风险"
                  : tone === "info"
                    ? "观察"
                    : "概览"
          }
          tone={tone}
        />
      </div>
    </SectionCard>
  );
}

export function KpiCard(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  return <MetricTile {...props} />;
}

export function StatusPill(props: {
  label: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const { label, tone = "neutral", className } = props;

  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        "tracking-[0.08em]",
        toneClassMap[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function InlineNotice(props: {
  tone?: Tone;
  title?: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { tone = "info", title, description, actions, className } = props;

  return (
    <div
      className={cn(
        "rounded-[14px] border px-4 py-3",
        toneClassMap[tone],
        className,
      )}
    >
      {title ? (
        <div className="text-sm font-medium text-[var(--app-text-strong)]">
          {title}
        </div>
      ) : null}
      <div className={cn("text-sm leading-6", title ? "mt-1" : undefined)}>
        {description}
      </div>
      {actions ? (
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function ActionStrip(props: {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
  className?: string;
}) {
  const { title, description, tone = "info", actions, className } = props;

  return (
    <div
      className={cn("rounded-[16px] border p-4", toneClassMap[tone], className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-base font-medium text-[var(--app-text-strong)]">
            {title}
          </div>
          {description ? (
            <div className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function ActionBanner(props: {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
}) {
  return <ActionStrip {...props} />;
}

export function ProgressBar(props: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const { value, tone = "info", className } = props;
  const width = Math.max(0, Math.min(100, value));

  const fillClass =
    tone === "success"
      ? "bg-[var(--app-success)]"
      : tone === "warning"
        ? "bg-[var(--app-warning)]"
        : tone === "danger"
          ? "bg-[var(--app-danger)]"
          : "bg-[var(--app-brand)]";

  return (
    <div className={cn("app-progress", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-200",
          fillClass,
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const { title, description, actions, className } = props;

  return (
    <div
      className={cn(
        "rounded-[16px] border border-dashed border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-5",
        className,
      )}
    >
      <div className="text-[18px] leading-none text-[var(--app-text-strong)]">
        {title}
      </div>
      {description ? (
        <div className="mt-2 max-w-2xl text-sm leading-6 text-[var(--app-text-muted)]">
          {description}
        </div>
      ) : null}
      {actions ? (
        <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function KeyPointList(props: {
  title: string;
  items: ReactNode[];
  emptyText?: string;
  tone?: Tone;
  className?: string;
}) {
  const {
    title,
    items,
    emptyText = "暂无内容",
    tone = "neutral",
    className,
  } = props;
  const renderedItems = React.Children.toArray(items);

  return (
    <SectionCard density="compact" surface="inset" className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-[var(--app-text-strong)]">
          {title}
        </div>
        <StatusPill label={renderedItems.length} tone={tone} />
      </div>

      {renderedItems.length === 0 ? (
        <div className="mt-3 text-sm leading-6 text-[var(--app-text-subtle)]">
          {emptyText}
        </div>
      ) : (
        <ul className="mt-3 grid gap-2">
          {renderedItems.map((item, index) => (
            <li
              key={
                typeof item === "string" || typeof item === "number"
                  ? `${title}-${String(item)}`
                  : React.isValidElement(item) && item.key !== null
                    ? String(item.key)
                    : `${title}-${index}`
              }
              className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-3 py-2 text-sm leading-6 text-[var(--app-text-muted)]"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function LoadingSkeleton(props: {
  rows?: number;
  className?: string;
  itemClassName?: string;
}) {
  const { rows = 3, className, itemClassName } = props;
  const placeholders = Array.from(
    { length: rows },
    (_value, placeholderIndex) => `skeleton-${placeholderIndex + 1}`,
  );

  return (
    <div className={cn("grid gap-3", className)}>
      {placeholders.map((placeholderId) => (
        <div
          key={placeholderId}
          className={cn(
            "app-skeleton h-[88px] rounded-[16px] border border-[var(--app-border-soft)]",
            itemClassName,
          )}
        />
      ))}
    </div>
  );
}

export function MiniTrendChart(props: {
  values: number[];
  tone?: Tone;
  className?: string;
}) {
  const { values, tone = "info", className } = props;
  const safeValues = values.length > 1 ? values : [0, values[0] ?? 0, 0];
  const max = Math.max(...safeValues, 1);
  const min = Math.min(...safeValues, 0);
  const range = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x = (index / (safeValues.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  const stroke =
    tone === "success"
      ? "var(--app-success)"
      : tone === "warning"
        ? "var(--app-warning)"
        : tone === "danger"
          ? "var(--app-danger)"
          : "var(--app-brand-strong)";

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={cn("h-16 w-full", className)}
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function BentoGrid(props: {
  children: ReactNode;
  className?: string;
  cols?: number;
}) {
  const { children, className, cols = 4 } = props;
  return (
    <div
      className={cn(
        "grid gap-4 auto-rows-[minmax(180px,auto)]",
        cols === 4 && "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
        cols === 3 && "grid-cols-1 md:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function BentoCard(props: {
  children: ReactNode;
  className?: string;
  span?: 1 | 2 | 3 | 4;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const { children, className, span = 1, title, description, actions } = props;
  return (
    <div
      className={cn(
        "glass-panel relative flex flex-col overflow-hidden rounded-xl p-6 transition-all duration-300 hover:border-[var(--app-border-strong)] hover:shadow-lg",
        span === 2 && "md:col-span-2",
        span === 3 && "md:col-span-3",
        span === 4 && "md:col-span-2 xl:col-span-4",
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && (
              <h3 className="text-lg font-semibold text-[var(--app-text-strong)]">
                {title}
              </h3>
            )}
            {description && (
              <p className="mt-1 text-xs text-[var(--app-text-muted)]">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (item: T) => ReactNode;
  mobileLabel?: ReactNode;
  className?: string;
  align?: "left" | "right";
};

export function DataTable<T>(props: {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (item: T, index: number) => string;
  empty: ReactNode;
  density?: Density;
  className?: string;
  selectedRowId?: string | null;
  onRowClick?: (item: T) => void;
}) {
  const {
    columns,
    rows,
    getRowId,
    empty,
    density = "comfortable",
    className,
    selectedRowId,
    onRowClick,
  } = props;

  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] md:block">
        <table className="app-table min-w-full">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={cn(
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const rowId = getRowId(row, index);
                const clickable = Boolean(onRowClick);

                return (
                  <tr
                    key={rowId}
                    className={cn(
                      selectedRowId === rowId && "bg-[var(--app-selection)]",
                      clickable && "cursor-pointer",
                    )}
                    onClick={() => onRowClick?.(row)}
                  >
                    {columns.map((column) => (
                      <td
                        key={`${rowId}-${column.key}`}
                        className={cn(
                          density === "compact" && "py-3",
                          column.align === "right" && "text-right",
                          column.className,
                        )}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {rows.length === 0
          ? empty
          : rows.map((row, index) => {
              const rowId = getRowId(row, index);

              return (
                <button
                  key={rowId}
                  type={onRowClick ? "button" : undefined}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4 text-left",
                    onRowClick && "cursor-pointer",
                    selectedRowId === rowId &&
                      "border-[var(--app-border-strong)] bg-[var(--app-bg-floating)]",
                  )}
                >
                  <div className="grid gap-3">
                    {columns.map((column) => (
                      <div
                        key={`${rowId}-${column.key}`}
                        className="grid gap-1 text-sm"
                      >
                        <div className="text-xs text-[var(--app-text-subtle)]">
                          {column.mobileLabel ?? column.header}
                        </div>
                        <div className="text-[var(--app-text)]">
                          {column.render(row)}
                        </div>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
      </div>
    </div>
  );
}

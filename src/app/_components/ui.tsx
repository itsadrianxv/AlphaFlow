"use client";

import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

type WorkspaceSection =
  | "home"
  | "screening"
  | "workflows"
  | "timing"
  | "companyResearch";

const navItems: Array<{
  key: WorkspaceSection;
  href: string;
  label: string;
  detail: string;
}> = [
  {
    key: "home",
    href: "/",
    label: "今日看板",
    detail: "优先事项、研究动态与组合语境",
  },
  {
    key: "screening",
    href: "/screening",
    label: "机会池",
    detail: "筛选命中、自选清单与候选沉淀",
  },
  {
    key: "workflows",
    href: "/workflows",
    label: "行业判断",
    detail: "赛道热度、机会验证与后续跟进",
  },
  {
    key: "companyResearch",
    href: "/company-research",
    label: "公司判断",
    detail: "证据、结论、风险与核验动作",
  },
  {
    key: "timing",
    href: "/timing",
    label: "择时组合",
    detail: "信号、仓位建议、复盘与预算",
  },
];

const toneClassMap: Record<Tone, string> = {
  neutral:
    "border-[rgba(128,142,160,0.24)] bg-[rgba(78,89,104,0.12)] text-[var(--app-text-muted)]",
  info: "border-[rgba(114,169,214,0.32)] bg-[rgba(25,55,82,0.24)] text-[var(--app-accent-strong)]",
  success:
    "border-[rgba(98,178,150,0.32)] bg-[rgba(24,58,49,0.24)] text-[var(--app-success)]",
  warning:
    "border-[rgba(191,154,96,0.32)] bg-[rgba(77,58,27,0.22)] text-[var(--app-warning)]",
  danger:
    "border-[rgba(201,119,132,0.32)] bg-[rgba(81,33,43,0.24)] text-[var(--app-danger)]",
};

function DeskMark() {
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[rgba(103,129,155,0.45)] bg-[rgba(12,18,25,0.96)] text-xs font-semibold tracking-[0.28em] text-[var(--app-accent-strong)]">
      SSB
    </div>
  );
}

export function WorkspaceShell(props: {
  section: WorkspaceSection;
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}) {
  const { section, eyebrow, title, description, actions, summary, children } =
    props;
  const activeItem = navItems.find((item) => item.key === section);

  return (
    <main className="app-shell">
      <div className="mx-auto grid min-h-screen w-full max-w-[1680px] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-[var(--app-border)] bg-[rgba(7,10,14,0.94)] lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
          <div className="flex h-full flex-col gap-6 px-4 py-5 sm:px-6 lg:px-5 lg:py-6">
            <div className="flex items-center gap-3">
              <DeskMark />
              <div>
                <p className="market-kicker">Stock Screening Boost</p>
                <p className="app-display mt-1 text-lg leading-none text-[var(--app-text)]">
                  投资决策终端
                </p>
              </div>
            </div>

            <nav className="grid gap-1.5">
              {navItems.map((item) => {
                const active = item.key === section;

                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={cn(
                      "rounded-[14px] border px-4 py-3 transition-colors",
                      active
                        ? "border-[rgba(110,136,161,0.42)] bg-[rgba(17,23,31,0.92)] text-[var(--app-text)]"
                        : "border-transparent text-[var(--app-text-muted)] hover:border-[var(--app-border)] hover:bg-[rgba(14,19,26,0.82)] hover:text-[var(--app-text)]",
                    )}
                  >
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto hidden lg:block">
              <div className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(10,14,19,0.92)] p-4">
                <p className="market-kicker">当前模块</p>
                <p className="mt-2 text-sm font-medium text-[var(--app-text)]">
                  {activeItem?.label ?? "研究界面"}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <section className="min-w-0 border-t border-[var(--app-border)] lg:border-t-0">
          <div className="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
            <header className="grid gap-5 border-b border-[var(--app-border)] pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="min-w-0">
                <p className="market-kicker">{eyebrow}</p>
                <h1 className="app-display mt-3 text-3xl tracking-[-0.03em] text-[var(--app-text)] sm:text-[40px]">
                  {title}
                </h1>
                {description ? (
                  <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)] sm:text-[15px]">
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

export function Panel(props: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { title, description, actions, className, children } = props;

  return (
    <section className={cn("app-panel p-5 sm:p-6", className)}>
      {title || description || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {title ? (
              <h2 className="app-display text-[22px] tracking-[-0.02em] text-[var(--app-text)]">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={cn(title || description || actions ? "mt-5" : "")}>
        {children}
      </div>
    </section>
  );
}

export function KpiCard(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
}) {
  const { label, value, hint, tone = "neutral" } = props;

  return (
    <article className="app-panel-muted rounded-[16px] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
          {label}
        </p>
        <span
          className={cn(
            "inline-flex min-h-6 min-w-6 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em]",
            toneClassMap[tone],
          )}
        >
          {tone === "success"
            ? "积极"
            : tone === "warning"
              ? "关注"
              : tone === "danger"
                ? "风险"
                : tone === "info"
                  ? "观察"
                  : "概览"}
        </span>
      </div>
      <p className="app-data mt-4 text-2xl text-[var(--app-text)] sm:text-[30px]">
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs leading-5 text-[var(--app-text-muted)]">
          {hint}
        </p>
      ) : null}
    </article>
  );
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
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        toneClassMap[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function ProgressBar(props: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const { value, tone = "info", className } = props;
  const width = Math.max(0, Math.min(100, value));

  return (
    <div className={cn("app-progress", className)}>
      <div
        className={cn(
          "h-full transition-[width] duration-200",
          tone === "success"
            ? "bg-[linear-gradient(90deg,#5ab892,#8de0bb)]"
            : tone === "warning"
              ? "bg-[linear-gradient(90deg,#bf9a60,#e0c08d)]"
              : tone === "danger"
                ? "bg-[linear-gradient(90deg,#c26c7b,#e3a0ad)]"
                : "bg-[linear-gradient(90deg,#6ca7d2,#9cc7e8)]",
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
}) {
  const { title, description, actions } = props;

  return (
    <div className="rounded-[16px] border border-dashed border-[var(--app-border)] bg-[rgba(12,16,22,0.82)] p-5 text-sm text-[var(--app-text-muted)]">
      <p className="text-[15px] font-medium text-[var(--app-text)]">{title}</p>
      {description ? (
        <p className="mt-2 max-w-2xl leading-6">{description}</p>
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
}) {
  const { title, items, emptyText = "暂无内容", tone = "neutral" } = props;
  const renderedItems = Children.toArray(items);

  return (
    <div className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.9)] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--app-text)]">{title}</p>
        <StatusPill label={items.length} tone={tone} />
      </div>
      {renderedItems.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[var(--app-text-soft)]">
          {emptyText}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {renderedItems.map((item, index) => (
            <li
              key={
                typeof item === "string" || typeof item === "number"
                  ? `${title}-${String(item)}`
                  : isValidElement(item) && item.key !== null
                    ? String(item.key)
                    : `${title}-${renderedItems.length}-${index}`
              }
              className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-3 py-2 text-sm leading-6 text-[var(--app-text-muted)]"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActionBanner(props: {
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
}) {
  const { title, description, tone = "info", actions } = props;

  return (
    <div
      className={cn(
        "rounded-[18px] border px-5 py-4",
        tone === "success"
          ? "border-[rgba(98,178,150,0.34)] bg-[rgba(18,45,38,0.72)]"
          : tone === "warning"
            ? "border-[rgba(191,154,96,0.34)] bg-[rgba(54,39,18,0.72)]"
            : tone === "danger"
              ? "border-[rgba(201,119,132,0.34)] bg-[rgba(56,24,31,0.74)]"
              : "border-[rgba(114,169,214,0.34)] bg-[rgba(18,32,47,0.76)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-medium text-[var(--app-text)]">{title}</p>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-text-muted)]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function statusTone(status: string | undefined): Tone {
  switch (status) {
    case "SUCCEEDED":
      return "success";
    case "FAILED":
      return "danger";
    case "RUNNING":
      return "info";
    case "PENDING":
      return "warning";
    default:
      return "neutral";
  }
}

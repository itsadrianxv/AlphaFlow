/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";

type AlphaFlowMarkProps = {
  className?: string;
  iconClassName?: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function AlphaFlowMark(props: AlphaFlowMarkProps) {
  const { className, iconClassName } = props;

  return (
    <span
      aria-hidden="true"
      data-brand-mark="alphaflow"
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel-strong)] shadow-[var(--app-shadow-sm)]",
        className,
      )}
    >
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-5 w-5", iconClassName)}
      >
        <title>AlphaFlow</title>
        <path
          d="M9.8 31.5 18.7 8h2.6l8.9 23.5h-4.9l-1.6-4.6h-7.4l-1.7 4.6Z"
          fill="#FFB84D"
        />
        <path d="m20 14.6-2.15 6.15h4.3L20 14.6Z" fill="#0D1118" />
        <path
          d="M12.4 25.9c3.2-3.7 7.2-5.5 12-5.5 2.7 0 5-.9 6.8-2.7"
          stroke="#3B9EFF"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="31.6" cy="17.7" r="2.2" fill="#3B9EFF" />
      </svg>
    </span>
  );
}

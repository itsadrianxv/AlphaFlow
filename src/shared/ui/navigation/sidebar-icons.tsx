/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function OverviewIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="5" rx="1.5" />
      <rect x="13" y="11" width="7" height="9" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
    </BaseIcon>
  );
}

export function ScreeningIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 6h16" />
      <path d="M7 11h10" />
      <path d="M10 16h4" />
      <path d="M11 16v4h2v-4" />
    </BaseIcon>
  );
}

export function OpportunityIntelligenceIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4.5 18.5 9 14l3 2.5 5.5-7 2 1.5" />
      <path d="M5 5h14" />
      <path d="M5 9h9" />
    </BaseIcon>
  );
}

export function WorkflowsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="7.5" cy="7.5" r="2.5" />
      <path d="m10 10 3.5 3.5" />
      <path d="M13 16h7" />
      <path d="m13 19 3-3 2 2 2-4" />
    </BaseIcon>
  );
}

export function CompanyResearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 20V6l7-2v16" />
      <path d="M12 20h7V9l-7-3" />
      <path d="M8 9h1" />
      <path d="M8 12h1" />
      <path d="M8 15h1" />
      <path d="M15 12h1" />
      <path d="M15 15h1" />
    </BaseIcon>
  );
}

export function TimingIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 18.5h14" />
      <path d="M8 8v8" />
      <path d="M8 11h2v4H8z" />
      <path d="M14 5v12" />
      <path d="M14 8h2v6h-2z" />
    </BaseIcon>
  );
}

export function WatchlistsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 6h10" />
      <path d="M9 12h10" />
      <path d="M9 18h10" />
      <circle cx="5.5" cy="6" r="1.25" />
      <circle cx="5.5" cy="12" r="1.25" />
      <path d="M4.5 17.25h2v2h-2z" />
    </BaseIcon>
  );
}

export function ResearchSpacesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 7.5 12 4l8 3.5-8 3.5z" />
      <path d="M4 12.5 12 16l8-3.5" />
      <path d="M4 17.5 12 21l8-3.5" />
    </BaseIcon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 12a8 8 0 1 0 2.35-5.65" />
      <path d="M4 4v4h4" />
      <path d="M12 8v5l3 2" />
    </BaseIcon>
  );
}

export function SidebarToggleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M10 5v14" />
    </BaseIcon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="5" width="4" height="14" rx="1.5" />
      <path d="M12 8h8" />
      <path d="M12 12h8" />
      <path d="M12 16h6" />
    </BaseIcon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </BaseIcon>
  );
}

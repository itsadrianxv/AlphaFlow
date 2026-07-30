"use client";

import { Check, X } from "lucide-react";

import { getPasswordRequirements } from "~/server/auth/credential-policy";

const requirementLabels = {
  length: "8 至 128 个字符",
  uppercase: "包含大写字母",
  lowercase: "包含小写字母",
  number: "包含数字",
  special: "包含特殊字符",
} as const;

export function PasswordRequirements(props: { password: string }) {
  const requirements = getPasswordRequirements(props.password);

  return (
    <ul className="grid grid-cols-1 gap-2 text-xs text-[var(--app-text-muted)] sm:grid-cols-2">
      {Object.entries(requirementLabels).map(([key, label]) => {
        const met = requirements[key as keyof typeof requirements];
        const Icon = met ? Check : X;
        return (
          <li key={key} className="flex min-w-0 items-center gap-2">
            <Icon
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 ${met ? "text-[var(--app-success)]" : "text-[var(--app-text-soft)]"}`}
            />
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

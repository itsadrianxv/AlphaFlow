"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { PasswordRequirements } from "~/app/_components/password-requirements";
import { InlineNotice } from "~/app/_components/ui";
import {
  type ChangePasswordActionState,
  changePassword,
} from "~/app/account/security/actions";

const initialState: ChangePasswordActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="app-button app-button-primary"
      disabled={pending}
    >
      {pending ? "修改中..." : "修改密码"}
    </button>
  );
}

export function ChangePasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [state, formAction] = useActionState(changePassword, initialState);

  return (
    <form action={formAction} className="grid max-w-lg gap-5">
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">当前密码</span>
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          className="app-input"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">新密码</span>
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          className="app-input"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />
      </label>
      <PasswordRequirements password={newPassword} />
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">确认新密码</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          className="app-input"
          required
        />
      </label>
      {state.error ? (
        <InlineNotice tone="warning" description={state.error} />
      ) : null}
      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

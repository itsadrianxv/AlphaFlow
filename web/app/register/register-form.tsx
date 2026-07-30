"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { PasswordRequirements } from "~/app/_components/password-requirements";
import { InlineNotice } from "~/app/_components/ui";
import {
  type RegisterActionState,
  registerWithCredentials,
} from "~/app/register/actions";

const initialState: RegisterActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="app-button app-button-primary w-full"
      disabled={pending}
    >
      {pending ? "注册中..." : "注册"}
    </button>
  );
}

export function RegisterForm(props: { redirectTo: string }) {
  const [password, setPassword] = useState("");
  const [state, formAction] = useActionState(
    registerWithCredentials,
    initialState,
  );
  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="redirectTo" value={props.redirectTo} />
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">
          手机号或邮箱
        </span>
        <input
          type="text"
          name="identifier"
          autoComplete="username"
          className="app-input"
          placeholder="输入中国大陆手机号或邮箱"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">密码</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          className="app-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <PasswordRequirements password={password} />
      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">确认密码</span>
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
      <SubmitButton />
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { InlineNotice } from "~/app/_components/ui";
import {
  type LoginActionState,
  signInWithCredentials,
} from "~/app/login/actions";

const initialState: LoginActionState = {
  error: null,
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="app-button app-button-primary w-full"
      disabled={pending}
    >
      {pending ? "登录中..." : "使用本地账号登录"}
    </button>
  );
}

export function CredentialsForm(props: { redirectTo: string }) {
  const { redirectTo } = props;
  const [state, formAction] = useActionState(
    signInWithCredentials,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">用户名</span>
        <input
          type="text"
          name="username"
          autoComplete="username"
          className="app-input"
          placeholder="输入已配置的登录账号"
        />
      </label>

      <label className="grid gap-2">
        <span className="text-sm text-[var(--app-text-muted)]">密码</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          className="app-input"
          placeholder="输入登录密码"
        />
      </label>

      {state.error ? (
        <InlineNotice tone="warning" description={state.error} />
      ) : null}

      <SubmitButton />
    </form>
  );
}

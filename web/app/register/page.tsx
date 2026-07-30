import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthLayout } from "~/app/login/auth-layout";
import { RegisterForm } from "~/app/register/register-form";
import { auth } from "~/server/auth";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";

export default async function RegisterPage(props: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");

  const searchParams = await props.searchParams;
  const redirectTo = resolveAuthRedirect(searchParams.redirectTo);

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-[var(--app-text-strong)]">
        注册账号
      </h1>
      <div className="mt-6">
        <RegisterForm redirectTo={redirectTo} />
        <p className="mt-5 text-center text-sm text-[var(--app-text-muted)]">
          已有账号？
          <Link
            href={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="ml-1 font-medium text-[var(--app-text-strong)] hover:underline"
          >
            返回登录
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

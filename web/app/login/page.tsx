import Link from "next/link";
import { redirect } from "next/navigation";
import { InlineNotice } from "~/app/_components/ui";
import { signInWithOAuth } from "~/app/login/actions";
import { AuthLayout } from "~/app/login/auth-layout";
import { CredentialsForm } from "~/app/login/credentials-form";
import { auth } from "~/server/auth";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";
import {
  signInMethods,
  socialSignInEnabled,
} from "~/server/auth/sign-in-methods";

function getAuthErrorMessage(errorCode?: string): string | null {
  switch (errorCode) {
    case "AccessDenied":
      return "当前账号没有访问权限，请联系管理员确认配置。";
    case "CallbackRouteError":
    case "OAuthCallbackError":
    case "OAuthSignin":
      return "第三方登录未完成，请稍后重试。";
    case "Configuration":
      return "认证配置尚未完成，请先检查部署环境变量。";
    case "Verification":
      return "登录验证已失效，请重新发起一次登录。";
    default:
      return null;
  }
}

export default async function LoginPage(props: {
  searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
    reason?: string;
    redirectTo?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const redirectTo = resolveAuthRedirect(
    searchParams.callbackUrl ?? searchParams.redirectTo,
  );
  const session = await auth();
  const sessionExpired = searchParams.reason === "session-expired";

  if (session?.user?.id && !sessionExpired) {
    redirect(redirectTo);
  }

  const authErrorMessage = getAuthErrorMessage(searchParams.error);

  return (
    <AuthLayout>
      <h1 className="text-2xl font-semibold text-[var(--app-text-strong)]">
        登录
      </h1>
      <div className="mt-6">
        {authErrorMessage ? (
          <InlineNotice tone="danger" description={authErrorMessage} />
        ) : null}

        {socialSignInEnabled ? (
          <div className="mt-5 grid gap-3">
            {signInMethods
              .filter((method) => method.type === "oauth")
              .map((method) => (
                <form key={method.id} action={signInWithOAuth}>
                  <input type="hidden" name="provider" value={method.id} />
                  <input type="hidden" name="redirectTo" value={redirectTo} />
                  <button type="submit" className="app-button w-full">
                    使用 {method.name} 登录
                  </button>
                </form>
              ))}
          </div>
        ) : null}

        <div className="mt-6 border-t border-[var(--app-border-soft)] pt-6">
          <CredentialsForm redirectTo={redirectTo} />
        </div>
        <p className="mt-5 text-center text-sm text-[var(--app-text-muted)]">
          还没有账号？
          <Link
            href={`/register?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="ml-1 font-medium text-[var(--app-text-strong)] hover:underline"
          >
            注册账号
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}

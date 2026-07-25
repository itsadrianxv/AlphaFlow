import Image from "next/image";
import { redirect } from "next/navigation";
import { InlineNotice } from "~/app/_components/ui";
import { signInWithOAuth } from "~/app/login/actions";
import { CredentialsForm } from "~/app/login/credentials-form";
import { LoginThemeToggle } from "~/app/login/theme-toggle";
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

  if (session?.user && !sessionExpired) {
    redirect(redirectTo);
  }

  const authErrorMessage = getAuthErrorMessage(searchParams.error);

  return (
    <main className="app-shell">
      <div className="fixed right-6 top-6 z-10 sm:right-8 sm:top-8">
        <LoginThemeToggle />
      </div>
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-[52vh] flex-col justify-center px-6 pb-12 pt-24 sm:px-10 lg:min-h-screen lg:px-16 lg:py-12">
          <Image
            src="https://opendoodles.s3-us-west-1.amazonaws.com/dancing.svg"
            alt=""
            aria-hidden="true"
            width={1024}
            height={768}
            priority
            className="login-dancing h-auto w-full max-w-[620px] object-contain object-left"
          />
          <p className="mt-8 max-w-[620px] text-2xl leading-tight tracking-[-0.02em] text-[var(--app-text-strong)] sm:text-3xl">
            AlphaFlow: agentic investment research workflows
          </p>
        </section>

        <section className="flex items-center border-t border-[var(--app-border-soft)] px-6 py-12 sm:px-10 lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full">
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
                      <input
                        type="hidden"
                        name="redirectTo"
                        value={redirectTo}
                      />
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
          </div>
        </section>
      </div>
    </main>
  );
}

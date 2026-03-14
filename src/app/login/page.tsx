import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithOAuth } from "~/app/login/actions";
import { CredentialsForm } from "~/app/login/credentials-form";
import { auth } from "~/server/auth";
import { resolveAuthRedirect } from "~/server/auth/redirect-utils";
import {
  signInMethods,
  socialSignInEnabled,
} from "~/server/auth/sign-in-methods";

const workflowStages = [
  {
    code: "01",
    title: "全市场筛选",
    detail: "先压掉噪音，只保留仍值得继续研究的股票池。",
  },
  {
    code: "02",
    title: "行业与公司研究",
    detail: "把催化、竞争格局、证据链和假设拆到同一张桌面上。",
  },
  {
    code: "03",
    title: "组合与择时",
    detail: "把仓位、风险预算和执行动作落到最终建议里。",
  },
];

const capabilityCards = [
  {
    label: "工作流",
    value: "LangGraph",
    detail: "统一编排研究链路、进度和回放。",
  },
  {
    label: "数据侧",
    value: "FastAPI + AkShare",
    detail: "把行情与基础金融数据拆到独立服务里。",
  },
  {
    label: "交付侧",
    value: "tRPC + Prisma",
    detail: "把研究结果沉淀到可追踪、可复用的数据结构。",
  },
];

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
    redirectTo?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const redirectTo = resolveAuthRedirect(
    searchParams.callbackUrl ?? searchParams.redirectTo,
  );
  const session = await auth();

  if (session?.user) {
    redirect(redirectTo);
  }

  const authErrorMessage = getAuthErrorMessage(searchParams.error);

  return (
    <main className="app-shell">
      <div className="mx-auto grid min-h-screen w-full max-w-[1520px] lg:grid-cols-[minmax(0,1.2fr)_420px]">
        <section className="border-b border-[var(--app-border)] px-5 py-6 sm:px-8 sm:py-8 lg:border-r lg:border-b-0 lg:px-10 lg:py-10">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[rgba(103,129,155,0.45)] bg-[rgba(12,18,25,0.96)] text-xs font-semibold tracking-[0.28em] text-[var(--app-accent-strong)]">
                SSB
              </div>
              <div>
                <p className="market-kicker">股票筛选增强</p>
                <p className="app-display mt-1 text-lg text-[var(--app-text)]">
                  投资研究工作台
                </p>
              </div>
            </Link>
            <Link href="/" className="app-button">
              返回看板
            </Link>
          </div>

          <div className="mt-10 max-w-3xl">
            <p className="market-kicker">登录研究空间</p>
            <h1 className="app-display mt-4 text-4xl leading-tight tracking-[-0.04em] text-[var(--app-text)] sm:text-5xl">
              把噪音隔在开盘前，把判断留在真正要下单的时刻。
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--app-text-muted)]">
              登录后，你可以继续股票筛选、行业研究、公司深挖和组合择时这整条链路，不用在不同工具之间来回切换。
            </p>
          </div>

          <div className="mt-10 grid gap-4 xl:grid-cols-3">
            {capabilityCards.map((card) => (
              <article
                key={card.label}
                className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(11,16,22,0.86)] p-5"
              >
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-text-soft)]">
                  {card.label}
                </p>
                <p className="mt-4 text-lg font-medium text-[var(--app-text)]">
                  {card.value}
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                  {card.detail}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-8 rounded-[18px] border border-[var(--app-border)] bg-[rgba(10,14,19,0.92)]">
            {workflowStages.map((stage, index) => (
              <div
                key={stage.code}
                className={`grid gap-3 px-5 py-5 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start ${
                  index === 0 ? "" : "border-t border-[var(--app-border)]"
                }`}
              >
                <div className="app-data text-sm text-[var(--app-text-soft)]">
                  {stage.code}
                </div>
                <div>
                  <p className="text-lg font-medium text-[var(--app-text)]">
                    {stage.title}
                  </p>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--app-text-muted)]">
                    {stage.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center px-5 py-8 sm:px-8 lg:px-8">
          <div className="app-panel w-full p-6 sm:p-7">
            <p className="market-kicker">账户访问</p>
            <h2 className="app-display mt-3 text-[30px] tracking-[-0.03em] text-[var(--app-text)]">
              继续进入研究工作台
            </h2>
            <p className="mt-3 text-sm leading-7 text-[var(--app-text-muted)]">
              使用你已经配置好的登录方式进入。成功登录后会回到你刚才想继续处理的页面。
            </p>

            {authErrorMessage ? (
              <div className="mt-5 rounded-[12px] border border-[rgba(201,119,132,0.34)] bg-[rgba(81,33,43,0.18)] px-4 py-3 text-sm text-[var(--app-danger)]">
                {authErrorMessage}
              </div>
            ) : null}

            {socialSignInEnabled ? (
              <div className="mt-6 grid gap-3">
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
                        <span>{`使用${method.name}登录`}</span>
                      </button>
                    </form>
                  ))}
              </div>
            ) : null}

            <div className="mt-6 border-t border-[var(--app-border)] pt-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--app-text)]">
                    本地账号密码
                  </p>
                  <p className="mt-1 text-xs leading-6 text-[var(--app-text-soft)]">
                    适用于本地开发、Docker 演示和内部部署环境。
                  </p>
                </div>
                <span className="inline-flex rounded-full border border-[rgba(114,169,214,0.32)] bg-[rgba(25,55,82,0.24)] px-2.5 py-1 text-[11px] font-medium text-[var(--app-accent-strong)]">
                  已启用
                </span>
              </div>

              <CredentialsForm redirectTo={redirectTo} />
            </div>

            <div className="mt-6 rounded-[14px] border border-[var(--app-border)] bg-[rgba(11,15,20,0.86)] p-4 text-sm leading-7 text-[var(--app-text-muted)]">
              <p className="text-[var(--app-text)]">部署提醒</p>
              <p className="mt-2">
                如果你是首次通过 Docker 启动，记得先在
                <code className="px-1.5 text-[var(--app-accent-strong)]">
                  deploy/.env
                </code>
                里填好
                <code className="px-1.5 text-[var(--app-accent-strong)]">
                  AUTH_SECRET
                </code>
                和所需的第三方登录配置。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { AlphaFlowMark } from "~/app/_components/brand/alpha-flow-mark";
import { InlineNotice, SectionCard, StatusPill } from "~/app/_components/ui";
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
    detail: "先压掉噪音，只保留值得继续研究的股票池。",
  },
  {
    code: "02",
    title: "行业与公司研究",
    detail: "把催化、竞争格局、证据链和核心假设收进同一条研究流。",
  },
  {
    code: "03",
    title: "组合与择时",
    detail: "把仓位、风险预算和执行动作落成最终建议。",
  },
];

const capabilityCards = [
  {
    label: "工作流",
    value: "LangGraph",
    detail: "统一编排研究链路、进度和回放。",
  },
  {
    label: "数据源",
    value: "FastAPI + AkShare",
    detail: "金融数据独立服务化，便于扩展和治理。",
  },
  {
    label: "交付层",
    value: "tRPC + Prisma",
    detail: "研究结果可追踪、可复用、可回放。",
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
      <div className="mx-auto grid min-h-screen w-full max-w-[1360px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:px-8 lg:py-10">
        <section className="grid content-start gap-6">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3">
              <AlphaFlowMark
                className="h-9 w-9 rounded-[9px] border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] shadow-none"
                iconClassName="h-[18px] w-[18px]"
              />
              <div>
                <div className="text-sm font-medium text-[var(--app-text-strong)]">
                  AlphaFlow
                </div>
                <div className="text-xs text-[var(--app-text-subtle)]">
                  投资决策工作台
                </div>
              </div>
            </Link>
            <Link href="/" className="app-button">
              返回总览
            </Link>
          </div>

          <div>
            <h1 className="app-display text-[34px] leading-tight text-[var(--app-text-strong)] sm:text-[42px]">
              在同一个工作台里完成筛选、研究和组合判断。
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--app-text-muted)]">
              登录后可以继续股票筛选、行业研究、公司判断和组合择时，不再需要在不同工具之间来回切换。
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {capabilityCards.map((card) => (
              <SectionCard
                key={card.label}
                density="compact"
                surface="inset"
                className="h-full"
              >
                <div className="text-xs text-[var(--app-text-subtle)]">
                  {card.label}
                </div>
                <div className="mt-3 text-lg font-medium text-[var(--app-text-strong)]">
                  {card.value}
                </div>
                <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                  {card.detail}
                </div>
              </SectionCard>
            ))}
          </div>

          <SectionCard
            title="工作流结构"
            description="你登录后看到的不是单一页面，而是一条完整的投研工作流。"
          >
            <div className="grid gap-3">
              {workflowStages.map((stage) => (
                <div
                  key={stage.code}
                  className="grid gap-3 rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] px-4 py-4 sm:grid-cols-[68px_minmax(0,1fr)]"
                >
                  <div className="app-data text-sm text-[var(--app-text-subtle)]">
                    {stage.code}
                  </div>
                  <div>
                    <div className="text-base font-medium text-[var(--app-text-strong)]">
                      {stage.title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                      {stage.detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <section className="flex items-start lg:sticky lg:top-10">
          <SectionCard
            title="登录"
            description="使用已配置的登录方式进入。登录成功后会回到你刚才准备继续处理的页面。"
            className="w-full"
            emphasis="strong"
          >
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--app-text-strong)]">
                    本地账号密码
                  </div>
                  <div className="mt-1 text-xs leading-6 text-[var(--app-text-subtle)]">
                    适用于本地开发、Docker 演示和内部部署环境。
                  </div>
                </div>
                <StatusPill label="已启用" tone="info" />
              </div>

              <CredentialsForm redirectTo={redirectTo} />
            </div>

            <div className="mt-6 rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4 text-sm leading-7 text-[var(--app-text-muted)]">
              <div className="font-medium text-[var(--app-text-strong)]">
                部署提醒
              </div>
              <p className="mt-2">
                如果你是第一次通过 Docker 启动，记得先在{" "}
                <code className="px-1 text-[var(--app-brand-strong)]">
                  deploy/.env
                </code>{" "}
                中补好{" "}
                <code className="px-1 text-[var(--app-brand-strong)]">
                  AUTH_SECRET
                </code>{" "}
                和所需的第三方登录配置。
              </p>
            </div>
          </SectionCard>
        </section>
      </div>
    </main>
  );
}

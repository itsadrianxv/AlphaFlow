"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  buildScreeningLoginHref,
  SCREENING_LOGIN_NOTICE,
} from "~/modules/screening/ui/access-control";
import { InlineNotice, SectionCard } from "~/shared/ui/primitives/ui";

const REDIRECT_DELAY_MS = 800;

export function ScreeningLoginRedirectNotice(props: { redirectTo: string }) {
  const { redirectTo } = props;
  const router = useRouter();
  const loginHref = buildScreeningLoginHref(redirectTo);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      router.replace(loginHref);
    }, REDIRECT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [loginHref, router]);

  return (
    <main className="app-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-[760px] items-center px-4 py-6 sm:px-6 lg:px-8">
        <SectionCard
          title="需要先登录"
          description="股票筛选工作台依赖受保护数据接口，登录后会自动返回当前页面。"
          className="w-full"
        >
          <InlineNotice tone="warning" description={SCREENING_LOGIN_NOTICE} />
          <div className="mt-4 text-sm leading-7 text-[var(--app-text-muted)]">
            如果没有自动跳转，可以手动进入登录页继续。
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={loginHref} className="app-button app-button-primary">
              前往登录
            </Link>
            <Link href="/" className="app-button">
              返回总览
            </Link>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}

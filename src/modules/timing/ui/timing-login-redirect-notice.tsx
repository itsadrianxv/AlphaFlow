"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  buildTimingLoginHref,
  TIMING_LOGIN_NOTICE,
} from "~/modules/timing/ui/access-control";
import { InlineNotice, SectionCard } from "~/shared/ui/primitives/ui";

const REDIRECT_DELAY_MS = 800;

export function TimingLoginRedirectNotice(props: { redirectTo: string }) {
  const { redirectTo } = props;
  const router = useRouter();
  const loginHref = buildTimingLoginHref(redirectTo);

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
          description="择时工作台依赖受保护的数据接口，登录后会自动返回当前页面。"
          className="w-full"
        >
          <InlineNotice tone="warning" description={TIMING_LOGIN_NOTICE} />
          <div className="mt-4 text-sm leading-7 text-[var(--app-text-muted)]">
            如果没有自动跳转，可以手动进入登录页后继续。
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

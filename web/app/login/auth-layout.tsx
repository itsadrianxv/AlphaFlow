import Image from "next/image";
import type { ReactNode } from "react";

import { LoginThemeToggle } from "~/app/login/theme-toggle";

export function AuthLayout(props: { children: ReactNode }) {
  return (
    <main className="app-shell">
      <div className="fixed right-6 top-6 z-10 sm:right-8 sm:top-8">
        <LoginThemeToggle />
      </div>
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-[44vh] flex-col justify-center px-6 pb-10 pt-20 sm:px-10 lg:min-h-screen lg:px-16 lg:py-12">
          <Image
            src="https://opendoodles.s3-us-west-1.amazonaws.com/dancing.svg"
            alt=""
            aria-hidden="true"
            width={1024}
            height={768}
            priority
            className="login-dancing h-auto w-full max-w-[620px] object-contain object-left"
          />
          <p className="mt-8 max-w-[620px] text-2xl leading-tight text-[var(--app-text-strong)] sm:text-3xl">
            AlphaFlow: agentic investment research workflows
          </p>
        </section>

        <section className="flex items-center border-t border-[var(--app-border-soft)] px-6 py-10 sm:px-10 lg:border-l lg:border-t-0 lg:px-12">
          <div className="w-full">{props.children}</div>
        </section>
      </div>
    </main>
  );
}

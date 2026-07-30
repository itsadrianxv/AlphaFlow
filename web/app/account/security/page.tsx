import { WorkspaceShell } from "~/app/_components/ui";
import { ChangePasswordForm } from "~/app/account/security/change-password-form";
import { requireAuth } from "~/server/auth/require-auth";

export default async function AccountSecurityPage() {
  await requireAuth("/account/security");

  return (
    <WorkspaceShell section="account" showHistory={false}>
      <div className="mx-auto w-full max-w-3xl py-4 sm:py-8">
        <header className="border-b border-[var(--app-border-soft)] pb-5">
          <h1 className="text-2xl font-semibold text-[var(--app-text-strong)]">
            账号安全
          </h1>
        </header>
        <section className="py-6">
          <h2 className="mb-5 text-base font-medium text-[var(--app-text-strong)]">
            修改密码
          </h2>
          <ChangePasswordForm />
        </section>
      </div>
    </WorkspaceShell>
  );
}

import React from "react";
import { TimingReportClient } from "~/modules/timing/ui/reports/[cardId]/timing-report-client";
import { TimingLoginRedirectNotice } from "~/modules/timing/ui/timing-login-redirect-notice";
import { auth } from "~/server/auth";

type PageProps = {
  params: Promise<{
    cardId: string;
  }>;
};

export default async function TimingReportPage({ params }: PageProps) {
  const session = await auth();
  const { cardId } = await params;

  if (!session?.user) {
    return (
      <TimingLoginRedirectNotice redirectTo={`/timing/reports/${cardId}`} />
    );
  }

  return (
    <React.Suspense fallback={null}>
      <TimingReportClient cardId={cardId} />
    </React.Suspense>
  );
}

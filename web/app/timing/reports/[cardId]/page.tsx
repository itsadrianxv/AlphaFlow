import React from "react";
import { TimingReportClient } from "~/app/timing/reports/[cardId]/timing-report-client";
import { requireAuth } from "~/server/auth/require-auth";

type PageProps = {
  params: Promise<{
    cardId: string;
  }>;
};

export default async function TimingReportPage({ params }: PageProps) {
  const { cardId } = await params;
  await requireAuth(`/timing/reports/${cardId}`);

  return (
    <React.Suspense fallback={null}>
      <TimingReportClient cardId={cardId} />
    </React.Suspense>
  );
}

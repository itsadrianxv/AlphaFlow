import { SpaceDetailClient } from "~/modules/research/ui/spaces/[spaceId]/space-detail-client";
import { auth } from "~/server/auth";

type PageProps = {
  params: Promise<{
    spaceId: string;
  }>;
};

export default async function ResearchSpaceDetailPage({ params }: PageProps) {
  await auth();
  const { spaceId } = await params;

  return <SpaceDetailClient spaceId={spaceId} />;
}

import { COMPANY_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

type ShouldShowRunDigestBannerParams = {
  templateCode?: string;
  status?: string;
  hasCompanyDetailModel: boolean;
};

export function shouldShowRunDigestBanner(
  params: ShouldShowRunDigestBannerParams,
) {
  const isStructuredCompanyResearchDetail =
    params.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE &&
    (params.status === "SUCCEEDED" || params.status === "PAUSED") &&
    params.hasCompanyDetailModel;

  return !isStructuredCompanyResearchDetail;
}

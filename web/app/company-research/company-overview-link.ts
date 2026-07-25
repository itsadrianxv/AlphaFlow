export function companyOverviewHref(stockCode: string) {
  return `/company-research?tab=overview&stockCode=${encodeURIComponent(stockCode)}`;
}

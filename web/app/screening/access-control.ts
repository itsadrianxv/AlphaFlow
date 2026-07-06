type ScreeningPageSearchParams = {
  workspaceId?: string | string[];
};

export const SCREENING_LOGIN_NOTICE = "你尚未登录，正在跳转到登录页。";

function getWorkspaceId(value: string | string[] | undefined) {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const trimmedItem = item.trim();
      if (trimmedItem.length > 0) {
        return trimmedItem;
      }
    }
  }

  return null;
}

export function buildScreeningRedirectTo(
  searchParams?: ScreeningPageSearchParams,
) {
  const workspaceId = getWorkspaceId(searchParams?.workspaceId);
  if (!workspaceId) {
    return "/screening";
  }

  const params = new URLSearchParams({
    workspaceId,
  });

  return `/screening?${params.toString()}`;
}

export function buildScreeningLoginHref(redirectTo: string) {
  return `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
}

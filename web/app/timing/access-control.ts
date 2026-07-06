export const TIMING_LOGIN_NOTICE =
  "你尚未登录，正在跳转到登录页后继续查看择时工作台。";

export function buildTimingLoginHref(redirectTo: string) {
  return `/login?redirectTo=${encodeURIComponent(redirectTo)}`;
}

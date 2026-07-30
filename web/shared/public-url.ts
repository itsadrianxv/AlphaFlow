type PublicUrlConfig = {
  authUrl?: string;
  vercelUrl?: string;
};

export function resolvePublicBaseUrl(config: PublicUrlConfig): string {
  const configuredUrl = config.authUrl?.trim() || undefined;
  const vercelUrl = config.vercelUrl?.trim();
  const rawUrl = configuredUrl ?? (vercelUrl ? `https://${vercelUrl}` : null);

  if (!rawUrl) {
    throw new Error(
      "未配置公开访问地址，请设置 AUTH_URL（例如 http://47.119.126.86:3000）。",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`AUTH_URL 不是有效的公开访问地址：${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`AUTH_URL 必须使用 HTTP 或 HTTPS：${rawUrl}`);
  }

  return url.toString().replace(/\/$/, "");
}

const UNKNOWN_CLIENT_IP = "unknown";

export function resolveClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwardedFor ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    UNKNOWN_CLIENT_IP
  );
}

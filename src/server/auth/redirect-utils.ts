const DEFAULT_AUTH_REDIRECT = "/";

export function resolveAuthRedirect(
  value: FormDataEntryValue | string | null | undefined,
): string {
  if (typeof value !== "string") {
    return DEFAULT_AUTH_REDIRECT;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return DEFAULT_AUTH_REDIRECT;
  }

  if (trimmedValue.startsWith("/") && !trimmedValue.startsWith("//")) {
    return trimmedValue;
  }

  try {
    const url = new URL(trimmedValue);
    const relativePath = `${url.pathname}${url.search}${url.hash}`;

    return relativePath.startsWith("/") ? relativePath : DEFAULT_AUTH_REDIRECT;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}

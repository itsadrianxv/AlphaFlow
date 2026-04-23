import { describe, expect, it } from "vitest";

import { resolveAuthRedirect } from "~/server/auth/redirect-utils";

describe("resolveAuthRedirect", () => {
  it("returns the default path when the input is missing", () => {
    expect(resolveAuthRedirect(undefined)).toBe("/");
    expect(resolveAuthRedirect(null)).toBe("/");
  });

  it("keeps safe relative paths", () => {
    expect(resolveAuthRedirect("/research?tab=active")).toBe(
      "/research?tab=active",
    );
  });

  it("converts absolute callback urls into local paths", () => {
    expect(resolveAuthRedirect("http://localhost:3000/screening?focus=1")).toBe(
      "/screening?focus=1",
    );
  });

  it("rejects protocol-relative and invalid redirects", () => {
    expect(resolveAuthRedirect("//evil.example.com")).toBe("/");
    expect(resolveAuthRedirect("not a valid url")).toBe("/");
  });
});

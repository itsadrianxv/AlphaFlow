import { describe, expect, it } from "vitest";

import {
  buildScreeningLoginHref,
  buildScreeningRedirectTo,
  SCREENING_LOGIN_NOTICE,
} from "~/modules/screening/ui/access-control";

describe("screening access control", () => {
  it("builds the default screening redirect target", () => {
    expect(buildScreeningRedirectTo()).toBe("/screening");
  });

  it("preserves workspaceId when building the screening redirect target", () => {
    expect(
      buildScreeningRedirectTo({
        workspaceId: "workspace-42",
      }),
    ).toBe("/screening?workspaceId=workspace-42");
  });

  it("builds a login href that returns to screening", () => {
    expect(buildScreeningLoginHref("/screening?workspaceId=workspace-42")).toBe(
      "/login?redirectTo=%2Fscreening%3FworkspaceId%3Dworkspace-42",
    );
  });

  it("exposes a clear login notice for unauthenticated users", () => {
    expect(SCREENING_LOGIN_NOTICE).toContain("未登录");
    expect(SCREENING_LOGIN_NOTICE).toContain("登录页");
  });
});

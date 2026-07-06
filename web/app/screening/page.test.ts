import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("~/server/auth", () => ({
  auth: authMock,
}));

vi.mock("~/app/screening/screening-studio-client", () => ({
  ScreeningStudioClient: () =>
    React.createElement("div", { "data-testid": "screening-studio" }, "studio"),
}));

vi.mock("~/app/screening/screening-login-redirect-notice", () => ({
  ScreeningLoginRedirectNotice: (props: { redirectTo: string }) =>
    React.createElement(
      "div",
      {
        "data-testid": "screening-login-redirect",
        "data-redirect-to": props.redirectTo,
      },
      "login notice",
    ),
}));

describe("ScreeningPage", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the login redirect notice when the user is not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const { default: ScreeningPage } = await import("~/app/screening/page");
    const markup = renderToStaticMarkup(
      await ScreeningPage({
        searchParams: Promise.resolve({
          workspaceId: "workspace-42",
        }),
      }),
    );

    expect(markup).toContain("screening-login-redirect");
    expect(markup).toContain("/screening?workspaceId=workspace-42");
    expect(markup).not.toContain("screening-studio");
  });

  it("renders the screening studio when the user is authenticated", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    const { default: ScreeningPage } = await import("~/app/screening/page");
    const markup = renderToStaticMarkup(
      await ScreeningPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(markup).toContain("screening-studio");
    expect(markup).not.toContain("screening-login-redirect");
  });
});

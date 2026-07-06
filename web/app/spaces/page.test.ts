import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("~/server/auth", () => ({
  auth: authMock,
}));

vi.mock("~/app/spaces/spaces-client", () => ({
  SpacesClient: () =>
    React.createElement("div", { "data-testid": "spaces-client" }, "spaces"),
}));

vi.mock("~/app/screening/screening-login-redirect-notice", () => ({
  ScreeningLoginRedirectNotice: (props: { redirectTo: string }) =>
    React.createElement(
      "div",
      {
        "data-testid": "spaces-login-redirect",
        "data-redirect-to": props.redirectTo,
      },
      "login notice",
    ),
}));

describe("SpacesPage", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the login redirect notice when the user is not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const { default: SpacesPage } = await import("~/app/spaces/page");
    const markup = renderToStaticMarkup(await SpacesPage());

    expect(markup).toContain("spaces-login-redirect");
    expect(markup).toContain("/spaces");
    expect(markup).not.toContain("spaces-client");
  });

  it("renders the spaces client when the user is authenticated", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    const { default: SpacesPage } = await import("~/app/spaces/page");
    const markup = renderToStaticMarkup(await SpacesPage());

    expect(markup).toContain("spaces-client");
    expect(markup).not.toContain("spaces-login-redirect");
  });
});

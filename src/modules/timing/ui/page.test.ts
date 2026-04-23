import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("~/server/auth", () => ({
  auth: authMock,
}));

vi.mock("~/modules/timing/ui/timing-client", () => ({
  TimingClient: () =>
    React.createElement("div", { "data-testid": "timing-client" }, "timing"),
}));

vi.mock("~/modules/timing/ui/timing-login-redirect-notice", () => ({
  TimingLoginRedirectNotice: (props: { redirectTo: string }) =>
    React.createElement(
      "div",
      {
        "data-testid": "timing-login-redirect",
        "data-redirect-to": props.redirectTo,
      },
      "login notice",
    ),
}));

describe("TimingPage", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the login redirect notice when the user is not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const { default: TimingPage } = await import("~/app/timing/page");
    const markup = renderToStaticMarkup(await TimingPage());

    expect(markup).toContain("timing-login-redirect");
    expect(markup).toContain("/timing");
    expect(markup).not.toContain("timing-client");
  });

  it("renders the timing client when the user is authenticated", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    const { default: TimingPage } = await import("~/app/timing/page");
    const markup = renderToStaticMarkup(await TimingPage());

    expect(markup).toContain("timing-client");
    expect(markup).not.toContain("timing-login-redirect");
  });
});

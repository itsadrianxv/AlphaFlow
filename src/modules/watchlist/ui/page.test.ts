import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("~/server/auth", () => ({
  auth: authMock,
}));

vi.mock("~/modules/watchlist/ui/watchlists-client", () => ({
  WatchlistsClient: () =>
    React.createElement(
      "div",
      { "data-testid": "watchlists-client" },
      "watchlists",
    ),
}));

vi.mock("~/modules/screening/ui/screening-login-redirect-notice", () => ({
  ScreeningLoginRedirectNotice: (props: { redirectTo: string }) =>
    React.createElement(
      "div",
      {
        "data-testid": "watchlists-login-redirect",
        "data-redirect-to": props.redirectTo,
      },
      "login notice",
    ),
}));

describe("WatchlistsPage", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the login redirect notice when the user is not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const { default: WatchlistsPage } = await import("~/app/watchlists/page");
    const markup = renderToStaticMarkup(await WatchlistsPage());

    expect(markup).toContain("watchlists-login-redirect");
    expect(markup).toContain("/watchlists");
    expect(markup).not.toContain("watchlists-client");
  });

  it("renders the watchlists client when the user is authenticated", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user-1",
      },
    });

    const { default: WatchlistsPage } = await import("~/app/watchlists/page");
    const markup = renderToStaticMarkup(await WatchlistsPage());

    expect(markup).toContain("watchlists-client");
    expect(markup).not.toContain("watchlists-login-redirect");
  });
});

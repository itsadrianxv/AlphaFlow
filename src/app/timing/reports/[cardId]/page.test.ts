import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();

vi.mock("~/server/auth", () => ({
  auth: authMock,
}));

vi.mock("~/app/timing/reports/[cardId]/timing-report-client", () => ({
  TimingReportClient: (props: { cardId: string }) =>
    React.createElement(
      "div",
      {
        "data-testid": "timing-report-client",
        "data-card-id": props.cardId,
      },
      "timing report",
    ),
}));

vi.mock("~/app/timing/timing-login-redirect-notice", () => ({
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

describe("TimingReportPage", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("renders the login redirect notice when the user is not authenticated", async () => {
    authMock.mockResolvedValue(null);

    const { default: TimingReportPage } = await import(
      "~/app/timing/reports/[cardId]/page"
    );
    const markup = renderToStaticMarkup(
      await TimingReportPage({
        params: Promise.resolve({
          cardId: "ck12345678901234567890123",
        }),
      }),
    );

    expect(markup).toContain("timing-login-redirect");
    expect(markup).toContain("/timing/reports/ck12345678901234567890123");
    expect(markup).not.toContain("timing-report-client");
  });

  it("renders the timing report client when the user is authenticated", async () => {
    authMock.mockResolvedValue({
      user: {
        id: "user_1",
      },
    });

    const { default: TimingReportPage } = await import(
      "~/app/timing/reports/[cardId]/page"
    );
    const markup = renderToStaticMarkup(
      await TimingReportPage({
        params: Promise.resolve({
          cardId: "ck12345678901234567890123",
        }),
      }),
    );

    expect(markup).toContain("timing-report-client");
    expect(markup).toContain("ck12345678901234567890123");
  });
});

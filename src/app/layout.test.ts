import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const createFont = () => ({
    variable: "--font-mock",
    className: "font-mock",
  });

  return {
    Cormorant_Garamond: createFont,
    IBM_Plex_Mono: createFont,
    IBM_Plex_Sans: createFont,
    Space_Grotesk: createFont,
  };
});

import { metadata } from "~/app/layout";

describe("app metadata", () => {
  it("publishes the AlphaFlow title and svg favicon", () => {
    expect(metadata.title).toBe("AlphaFlow · 投资决策工作流");
    expect(metadata.icons).toEqual([{ rel: "icon", url: "/icon.svg" }]);
  });
});

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("HomePage server boundary", () => {
  it("keeps statusTone in a server-safe shared module", () => {
    const sharedHelperPath = path.resolve(
      process.cwd(),
      "app/_components/status-tone.ts",
    );

    expect(existsSync(sharedHelperPath)).toBe(true);

    const homePageSource = readSource("app/page.tsx");
    const uiSource = readSource("app/_components/ui.tsx");

    expect(homePageSource).toContain('from "~/app/_components/status-tone"');
    expect(homePageSource).not.toContain(
      'statusTone,\n  WorkspaceShell,\n} from "~/app/_components/ui"',
    );
    expect(uiSource).not.toContain("export function statusTone");
  });

  it("keeps home header actions focused on the primary CTA instead of repeating module navigation", () => {
    const homePageSource = readSource("app/page.tsx");

    expect(homePageSource).toContain(
      'actions={\n          <Link href={primaryHref} className="app-button app-button-primary">',
    );
  });

  it("loads the dark editorial theme from the root layout and global styles", () => {
    const layoutSource = readSource("app/layout.tsx");
    const globalsSource = readSource("styles/globals.css");

    expect(layoutSource).toContain("Cormorant_Garamond");
    expect(layoutSource).toContain("Space_Grotesk");
    expect(layoutSource).toContain("IBM_Plex_Sans");
    expect(layoutSource).toContain("IBM_Plex_Mono");
    expect(globalsSource).toContain("color-scheme: dark");
    expect(globalsSource).toContain("--app-bg: #000000");
    expect(globalsSource).toContain("--app-text: #f0f0f0");
    expect(globalsSource).toContain("--app-border: rgba(214, 235, 253, 0.19)");
  });

  it("keeps Tailwind scanning the web subproject", () => {
    const globalsSource = readSource("styles/globals.css");

    expect(globalsSource).toContain('@import "tailwindcss" source(none)');
    expect(globalsSource).toContain('@source ".."');
  });
});

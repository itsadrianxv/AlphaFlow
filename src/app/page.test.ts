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
      "src/app/_components/status-tone.ts",
    );

    expect(existsSync(sharedHelperPath)).toBe(true);

    const homePageSource = readSource("src/app/page.tsx");
    const uiSource = readSource("src/app/_components/ui.tsx");

    expect(homePageSource).toContain('from "~/app/_components/status-tone"');
    expect(homePageSource).not.toContain(
      'statusTone,\n  WorkspaceShell,\n} from "~/app/_components/ui"',
    );
    expect(uiSource).not.toContain("export function statusTone");
  });

  it("keeps home header actions focused on the primary CTA instead of repeating module navigation", () => {
    const homePageSource = readSource("src/app/page.tsx");

    expect(homePageSource).toContain(
      'actions={\n          <Link href={primaryHref} className="app-button app-button-primary">',
    );
  });
});

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "..");

function srcPath(...segments: string[]) {
  return path.join(srcRoot, ...segments);
}

function readUtf8(...segments: string[]) {
  return readFileSync(srcPath(...segments), "utf8");
}

function listFilesRecursively(rootPath: string): string[] {
  const entries = readdirSync(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(fullPath));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

describe("module structure", () => {
  it("introduces platform, shared, and domain-first module directories", () => {
    expect(existsSync(srcPath("platform"))).toBe(true);
    expect(existsSync(srcPath("platform", "db"))).toBe(true);
    expect(existsSync(srcPath("platform", "trpc"))).toBe(true);
    expect(existsSync(srcPath("platform", "env"))).toBe(true);
    expect(existsSync(srcPath("shared", "ui", "primitives"))).toBe(true);
    expect(existsSync(srcPath("shared", "ui", "layout"))).toBe(true);
    expect(existsSync(srcPath("shared", "ui", "navigation"))).toBe(true);

    for (const moduleName of [
      "auth",
      "market",
      "research",
      "screening",
      "timing",
      "watchlist",
    ]) {
      expect(existsSync(srcPath("modules", moduleName))).toBe(true);
      expect(existsSync(srcPath("modules", moduleName, "ui"))).toBe(true);
      expect(existsSync(srcPath("modules", moduleName, "server"))).toBe(true);
    }
  });

  it("switches app routes to the new research-first URL structure", () => {
    expect(existsSync(srcPath("app", "research", "page.tsx"))).toBe(true);
    expect(existsSync(srcPath("app", "research", "company", "page.tsx"))).toBe(
      true,
    );
    expect(existsSync(srcPath("app", "research", "spaces", "page.tsx"))).toBe(
      true,
    );
    expect(
      existsSync(srcPath("app", "research", "runs", "[runId]", "page.tsx")),
    ).toBe(true);
    expect(
      existsSync(
        srcPath("app", "research", "runs", "[runId]", "debug", "page.tsx"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        srcPath(
          "app",
          "api",
          "research",
          "runs",
          "[runId]",
          "events",
          "route.ts",
        ),
      ),
    ).toBe(true);

    expect(existsSync(srcPath("app", "workflows", "page.tsx"))).toBe(false);
    expect(existsSync(srcPath("app", "company-research", "page.tsx"))).toBe(
      false,
    );
    expect(existsSync(srcPath("app", "spaces", "page.tsx"))).toBe(false);
    expect(
      existsSync(
        srcPath(
          "app",
          "api",
          "workflows",
          "runs",
          "[runId]",
          "events",
          "route.ts",
        ),
      ),
    ).toBe(false);
  });

  it("replaces legacy top-level routers with research and market namespaces", () => {
    const rootRouterSource = readUtf8("server", "api", "root.ts");

    expect(rootRouterSource).toContain("market: marketRouter");
    expect(rootRouterSource).toContain("research: researchRouter");
    expect(rootRouterSource).not.toContain("workflow:");
    expect(rootRouterSource).not.toContain("intelligence:");
    expect(rootRouterSource).not.toContain("space:");
    expect(rootRouterSource).not.toContain("marketContext:");
    expect(rootRouterSource).not.toContain("post:");

    expect(existsSync(srcPath("server", "api", "routers", "research.ts"))).toBe(
      true,
    );
    expect(existsSync(srcPath("server", "api", "routers", "market.ts"))).toBe(
      true,
    );
    expect(existsSync(srcPath("server", "api", "routers", "workflow.ts"))).toBe(
      false,
    );
    expect(
      existsSync(srcPath("server", "api", "routers", "intelligence.ts")),
    ).toBe(false);
    expect(existsSync(srcPath("server", "api", "routers", "space.ts"))).toBe(
      false,
    );
    expect(
      existsSync(srcPath("server", "api", "routers", "market-context.ts")),
    ).toBe(false);
    expect(existsSync(srcPath("server", "api", "routers", "post.ts"))).toBe(
      false,
    );
  });

  it("keeps app layer from importing domain or infrastructure internals directly", () => {
    const appFiles = listFilesRecursively(srcPath("app")).filter((filePath) =>
      /\.(ts|tsx)$/.test(filePath),
    );
    const offenders: string[] = [];

    for (const filePath of appFiles) {
      const source = readFileSync(filePath, "utf8");
      const importsImplementationInternals =
        /from\s+["']~\/server\/(?:domain|infrastructure)\//.test(source) ||
        /from\s+["']~\/modules\/[^"']+\/server\/(?:domain|infrastructure)\//.test(
          source,
        );

      if (importsImplementationInternals) {
        offenders.push(path.relative(srcRoot, filePath));
      }
    }

    expect(offenders).toEqual([]);
  });
});

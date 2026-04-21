import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("FunASR build dependencies", () => {
  it("includes modelscope in the Python runtime dependency source of truth", () => {
    const pyproject = readFileSync(
      path.join(repoRoot, "python_services", "pyproject.toml"),
      "utf8",
    );
    const uvLock = readFileSync(
      path.join(repoRoot, "python_services", "uv.lock"),
      "utf8",
    );
    const downloadScript = readFileSync(
      path.join(
        repoRoot,
        "python_services",
        "scripts",
        "download_funasr_models.py",
      ),
      "utf8",
    );

    expect(downloadScript).toContain("from modelscope.hub.snapshot_download");
    expect(pyproject).toContain('"modelscope');
    expect(uvLock).toContain('name = "modelscope"');
  });
});

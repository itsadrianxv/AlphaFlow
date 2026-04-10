import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ScreeningStudioClient copy", () => {
  it("keeps strict screening copy provider-neutral and skips fetch success notices", () => {
    const source = readFileSync(
      new URL("./screening-studio-client.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("iFinD");

    const queryDatasetMutationSection = source.match(
      /const queryDatasetMutation = api\.screening\.queryDataset\.useMutation\(\{([\s\S]*?)\n {2}}\);\n {2}const validateFormulaMutation/,
    );

    expect(queryDatasetMutationSection?.[1]).toBeDefined();
    expect(queryDatasetMutationSection?.[1]).not.toContain('tone: "success"');
  });
});

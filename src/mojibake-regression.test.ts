import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const sourceRoots = ["src/app", "src/server"];
const textFileExtensions = new Set([".ts", ".tsx"]);

const mojibakePattern =
  /缁|鎷|涓|鍏|璇|銆|锛|绛|鏂|瀹|妗|浠|鏁|瑕|杩|寮|搴|鍙|淇|闆|灞|鍥|鐢|甯|姝|姣|杈|棰|鑷|閮|宸|鎭|楠|绀|閹|閺|瀵|娑|鐟|婢|瑜|妤|娴/;

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return listSourceFiles(fullPath);
    }

    return textFileExtensions.has(path.extname(entry)) ? [fullPath] : [];
  });
}

test("source UI and server text does not contain mojibake Chinese", () => {
  const offenders = sourceRoots
    .flatMap((root) => listSourceFiles(root))
    .flatMap((filePath) => {
      const content = readFileSync(filePath, "utf8");
      return content
        .split(/\r?\n/)
        .map((line, index) => ({ filePath, line, lineNumber: index + 1 }))
        .filter(({ line }) => mojibakePattern.test(line));
    });

  expect(offenders).toEqual([]);
});

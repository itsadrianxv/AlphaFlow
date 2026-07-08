import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkills, type Skill } from "@earendil-works/pi-agent-core";
import { RestrictedExecutionEnv } from "./restricted-env";
import type { SkillSummary } from "./types";

const runtimeDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const defaultSkillsRoot = path.resolve(runtimeDir, "skills");

export class SkillRegistry {
  private readonly skillsById = new Map<string, Skill>();
  private diagnostics: string[] = [];

  constructor(private readonly skillsRoot = defaultSkillsRoot) {}

  async load() {
    const env = new RestrictedExecutionEnv({
      cwd: this.skillsRoot,
      readRoots: [this.skillsRoot],
    });
    const result = await loadSkills(env, [this.skillsRoot]);

    this.skillsById.clear();
    this.diagnostics = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
    );

    for (const skill of result.skills) {
      this.skillsById.set(skill.name, skill);
    }

    return this;
  }

  get(skillId: string) {
    return this.skillsById.get(skillId) ?? null;
  }

  list(): SkillSummary[] {
    return [...this.skillsById.values()].map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      type: skill.name.includes("mcp") ? "tool" : "prompt",
      permissions: skill.name.includes("mcp")
        ? ["network", "filesystem_read", "child_process"]
        : ["prompt"],
    }));
  }

  getDiagnostics() {
    return [...this.diagnostics];
  }
}

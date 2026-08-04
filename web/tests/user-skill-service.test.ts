import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseUserSkillContent,
  USER_SKILL_ID_PREFIX,
  UserSkillService,
} from "~/server/application/agent-runtime/user-skill-service";

function createFakeDb(): any {
  const skills: Array<{
    id: string;
    userId: string;
    currentVersion: number;
    enabled: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = [];
  const versions: Array<{
    id: string;
    skillId: string;
    version: number;
    name: string;
    description: string;
    content: string;
    contentHash: string;
    createdAt: Date;
  }> = [];
  let skillSequence = 0;
  let versionSequence = 0;

  const withVersions = (skill: (typeof skills)[number]) => ({
    ...skill,
    versions: versions
      .filter((version) => version.skillId === skill.id)
      .sort((left, right) => right.version - left.version)
      .slice(0, 1),
  });

  return {
    userSkill: {
      findMany: async (query: {
        where: {
          id?: { in: string[] };
          userId: string;
          enabled?: boolean;
          archivedAt?: null;
        };
      }) =>
        skills
          .filter(
            (skill) =>
              skill.userId === query.where.userId &&
              (query.where.archivedAt === undefined ||
                skill.archivedAt === query.where.archivedAt) &&
              (query.where.enabled === undefined ||
                skill.enabled === query.where.enabled) &&
              (!query.where.id || query.where.id.in.includes(skill.id)),
          )
          .map(withVersions),
      create: async (query: {
        data: {
          userId: string;
          versions: {
            create: {
              version: number;
              name: string;
              description: string;
              content: string;
              contentHash: string;
            };
          };
        };
      }) => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const skill = {
          id: `skill-${++skillSequence}`,
          userId: query.data.userId,
          currentVersion: 1,
          enabled: true,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        skills.push(skill);
        versions.push({
          id: `version-${++versionSequence}`,
          skillId: skill.id,
          createdAt: now,
          ...query.data.versions.create,
        });
        return withVersions(skill);
      },
      findFirst: async (query: {
        where: { id: string; userId: string; archivedAt: null };
      }) => {
        const skill = skills.find(
          (item) =>
            item.id === query.where.id &&
            item.userId === query.where.userId &&
            item.archivedAt === null,
        );
        return skill ? withVersions(skill) : null;
      },
      update: async (query: {
        where: { id: string };
        data: { currentVersion: number };
      }) => {
        const skill = skills.find((item) => item.id === query.where.id);
        if (!skill) throw new Error("not found");
        skill.currentVersion = query.data.currentVersion;
        skill.updatedAt = new Date("2026-08-04T00:01:00.000Z");
        return withVersions(skill);
      },
      updateMany: async (query: {
        where: { id: string; userId: string; archivedAt: null };
        data: { enabled?: boolean; archivedAt?: Date };
      }) => {
        const skill = skills.find(
          (item) =>
            item.id === query.where.id &&
            item.userId === query.where.userId &&
            item.archivedAt === null,
        );
        if (!skill) return { count: 0 };
        if (query.data.enabled !== undefined) skill.enabled = query.data.enabled;
        if (query.data.archivedAt) skill.archivedAt = query.data.archivedAt;
        return { count: 1 };
      },
    },
    userSkillVersion: {
      create: async (query: {
        data: {
          skillId: string;
          version: number;
          name: string;
          description: string;
          content: string;
          contentHash: string;
        };
      }) => {
        versions.push({
          id: `version-${++versionSequence}`,
          createdAt: new Date("2026-08-04T00:01:00.000Z"),
          ...query.data,
        });
      },
    },
    $transaction: async <T>(callback: (tx: ReturnType<typeof createFakeDb>) => T) =>
      callback(fakeDb as ReturnType<typeof createFakeDb>),
  };
}

const fakeDb = createFakeDb();

describe("用户自定义投研 Skill", () => {
  it("从 frontmatter 解析名称、描述并保留中文 UTF-8 正文", () => {
    const parsed = parseUserSkillContent(`---
name: 财报质量检查
description: 检查收入、利润和现金流质量
---

# 财报质量检查

中文正文。`);

    expect(parsed.name).toBe("财报质量检查");
    expect(parsed.description).toBe("检查收入、利润和现金流质量");
    expect(parsed.content).toContain("中文正文");
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("缺少 frontmatter 时从标题和正文生成元数据", () => {
    const parsed = parseUserSkillContent("# 产业链跟踪\n\n按上中下游拆解。");

    expect(parsed.name).toBe("产业链跟踪");
    expect(parsed.description).toBe("按上中下游拆解。");
  });

  it("编辑生成新版本，停用后不能为新运行解析 runtime definition", async () => {
    const service = new UserSkillService(fakeDb as never);
    const created = await service.create({
      userId: "user-a",
      content: "---\nname: 版本一\ndescription: 第一版\n---\n\n# 版本一",
    });
    const updated = await service.update({
      userId: "user-a",
      skillId: created.userSkillId,
      content: "---\nname: 版本二\ndescription: 第二版\n---\n\n# 版本二",
    });

    expect(updated.version).toBe(2);
    const definitions = await service.resolveRuntimeDefinitions("user-a", [
      `${USER_SKILL_ID_PREFIX}${created.userSkillId}`,
    ]);
    expect(definitions[0]?.version).toBe(2);
    expect(definitions[0]?.name).toBe("版本二");

    await service.setEnabled({
      userId: "user-a",
      skillId: created.userSkillId,
      enabled: false,
    });
    await expect(
      service.resolveRuntimeDefinitions("user-a", [
        `${USER_SKILL_ID_PREFIX}${created.userSkillId}`,
      ]),
    ).rejects.toThrow("用户 Skill 不存在或已停用");
  });

  it("runtime 默认禁止执行任意 shell，用户 Skill 不能靠脚本扩权", async () => {
    const source = await readFile(
      path.join(process.cwd(), "../agent_runtime/src/restricted-env.ts"),
      "utf8",
    );

    expect(source).toContain("shell_unavailable");
    expect(source).toContain("agent-runtime 默认禁止执行任意 shell 命令");
  });
});

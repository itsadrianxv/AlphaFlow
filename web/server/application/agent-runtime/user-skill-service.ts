import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export const USER_SKILL_ID_PREFIX = "user-skill:";
export const USER_SKILL_MAX_BYTES = 1024 * 1024;
export const USER_SKILL_MAX_CHARS = 100_000;
export const USER_SKILL_MAX_NAME_CHARS = 120;
export const USER_SKILL_MAX_DESCRIPTION_CHARS = 500;

export type UserSkillRuntimeDefinition = {
  id: string;
  versionId: string;
  version: number;
  name: string;
  description: string;
  content: string;
  contentHash: string;
};

function normalizeLine(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseMarkdownMetadata(content: string, filename?: string) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const metadata: Record<string, string> = {};
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex(
      (line, index) => index > 0 && line.trim() === "---",
    );
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const separator = line.indexOf(":");
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1);
        if (key) metadata[key] = unquote(value);
      }
    }
  }

  const heading = lines.find((line) => /^#\s+\S/.test(line.trim()));
  const headingName = heading?.trim().replace(/^#\s+/, "").trim();
  const fallbackName =
    headingName ||
    filename
      ?.replace(/\.[^.]+$/, "")
      .replace(/[-_]+/g, " ")
      .trim() ||
    "未命名投研 Skill";
  const name = normalizeLine(metadata.name || fallbackName).slice(
    0,
    USER_SKILL_MAX_NAME_CHARS,
  );
  const description = normalizeLine(
    metadata.description ||
      lines
        .slice(0, 40)
        .find((line) => line.trim() && !line.trim().startsWith("#"))
        ?.trim() ||
      "用户自定义投研分析框架",
  ).slice(0, USER_SKILL_MAX_DESCRIPTION_CHARS);

  return { name: name || "未命名投研 Skill", description };
}

export function parseUserSkillContent(content: string, filename?: string) {
  const normalized = content.replace(/\r\n/g, "\n");
  const byteLength = Buffer.byteLength(normalized, "utf8");
  if (byteLength > USER_SKILL_MAX_BYTES) {
    throw new Error("Skill 文件不能超过 1 MB");
  }
  if (normalized.length > USER_SKILL_MAX_CHARS) {
    throw new Error("Skill 正文不能超过 100000 个字符");
  }
  if (!normalized.trim()) {
    throw new Error("Skill 正文不能为空");
  }

  const metadata = parseMarkdownMetadata(normalized, filename);
  const contentHash = createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex");
  return { content: normalized, contentHash, ...metadata };
}

function toPublicSkill(skill: {
  id: string;
  currentVersion: number;
  enabled: boolean;
  updatedAt: Date;
  versions: Array<{
    id: string;
    version: number;
    name: string;
    description: string;
    content: string;
    contentHash: string;
  }>;
}) {
  const current = skill.versions[0];
  return {
    id: `${USER_SKILL_ID_PREFIX}${skill.id}`,
    userSkillId: skill.id,
    versionId: current?.id ?? "",
    version: skill.currentVersion,
    name: current?.name ?? "未命名投研 Skill",
    description: current?.description ?? "",
    content: current?.content ?? "",
    enabled: skill.enabled,
    updatedAt: skill.updatedAt,
    contentHash: current?.contentHash ?? "",
  };
}

export class UserSkillService {
  constructor(private readonly db: PrismaClient) {}

  async list(userId: string) {
    const skills = await this.db.userSkill.findMany({
      where: { userId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            name: true,
            description: true,
            content: true,
            contentHash: true,
          },
        },
      },
    });
    return skills.map(toPublicSkill);
  }

  async create(params: { userId: string; content: string; filename?: string }) {
    const parsed = parseUserSkillContent(params.content, params.filename);
    const skill = await this.db.userSkill.create({
      data: {
        userId: params.userId,
        versions: {
          create: {
            version: 1,
            name: parsed.name,
            description: parsed.description,
            content: parsed.content,
            contentHash: parsed.contentHash,
          },
        },
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return toPublicSkill(skill);
  }

  async update(params: { userId: string; skillId: string; content: string }) {
    const parsed = parseUserSkillContent(params.content);
    const skill = await this.db.userSkill.findFirst({
      where: { id: params.skillId, userId: params.userId, archivedAt: null },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!skill) throw new Error("用户 Skill 不存在");
    const nextVersion = skill.currentVersion + 1;
    const updated = await this.db.$transaction(async (tx) => {
      await tx.userSkillVersion.create({
        data: {
          skillId: skill.id,
          version: nextVersion,
          name: parsed.name,
          description: parsed.description,
          content: parsed.content,
          contentHash: parsed.contentHash,
        },
      });
      return tx.userSkill.update({
        where: { id: skill.id },
        data: { currentVersion: nextVersion },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      });
    });
    return toPublicSkill(updated);
  }

  async setEnabled(params: {
    userId: string;
    skillId: string;
    enabled: boolean;
  }) {
    const skill = await this.db.userSkill.updateMany({
      where: { id: params.skillId, userId: params.userId, archivedAt: null },
      data: { enabled: params.enabled },
    });
    if (skill.count === 0) throw new Error("用户 Skill 不存在");
    return { success: true, enabled: params.enabled };
  }

  async archive(params: { userId: string; skillId: string }) {
    const result = await this.db.userSkill.updateMany({
      where: { id: params.skillId, userId: params.userId, archivedAt: null },
      data: { archivedAt: new Date(), enabled: false },
    });
    if (result.count === 0) throw new Error("用户 Skill 不存在");
    return { success: true };
  }

  async resolveRuntimeDefinitions(userId: string, ids: string[]) {
    const userSkillIds = ids
      .filter((id) => id.startsWith(USER_SKILL_ID_PREFIX))
      .map((id) => id.slice(USER_SKILL_ID_PREFIX.length));
    if (userSkillIds.length === 0) return [];

    const skills = await this.db.userSkill.findMany({
      where: {
        id: { in: userSkillIds },
        userId,
        enabled: true,
        archivedAt: null,
      },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });
    const found = new Set(
      skills.map((skill) => `${USER_SKILL_ID_PREFIX}${skill.id}`),
    );
    const missing = ids.find(
      (id) => id.startsWith(USER_SKILL_ID_PREFIX) && !found.has(id),
    );
    if (missing) throw new Error(`用户 Skill 不存在或已停用: ${missing}`);

    return skills.map((skill) => {
      const version = skill.versions[0];
      if (!version) throw new Error(`用户 Skill 缺少版本: ${skill.id}`);
      return {
        id: `${USER_SKILL_ID_PREFIX}${skill.id}`,
        versionId: version.id,
        version: version.version,
        name: version.name,
        description: version.description,
        content: version.content,
        contentHash: version.contentHash,
      };
    });
  }
}

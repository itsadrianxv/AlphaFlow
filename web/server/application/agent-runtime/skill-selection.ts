export const MAX_SELECTED_SKILLS = 3;
export const MAX_SELECTED_SKILLS_MESSAGE = "最多选择 3 个 skill";

export function normalizeSelectedSkillIds(input: {
  skillId?: string;
  skillIds?: string[];
}) {
  const orderedIds = [...(input.skillIds ?? []), input.skillId ?? ""]
    .map((item) => item.trim())
    .filter(Boolean);
  const skillIds = [...new Set(orderedIds)];

  if (skillIds.length === 0) {
    throw new Error("请选择 skill");
  }

  if (skillIds.length > MAX_SELECTED_SKILLS) {
    throw new Error(MAX_SELECTED_SKILLS_MESSAGE);
  }

  return {
    skillId: skillIds[0] ?? "",
    skillIds,
  };
}

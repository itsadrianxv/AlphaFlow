"use client";

import { Power, Save, Trash2, Upload } from "lucide-react";
import { useId, useState } from "react";
import { MoonIcon, SunIcon } from "~/app/_components/sidebar-icons";
import { useTheme } from "~/app/_components/theme-provider";
import { WorkspaceShell } from "~/app/_components/workspace-shell";
import { ChangePasswordForm } from "~/app/account/security/change-password-form";
import { ResearchRadarPanel } from "~/app/research-radar/research-radar-client";
import { api, type RouterOutputs } from "~/trpc/react";
import { ResearchPreferenceImportPanel } from "./research-preference-import-panel";

type UserSkill = RouterOutputs["agentRuntime"]["listMySkills"][number];

const EMPTY_SKILL_TEMPLATE = `---
name: 我的投研 Skill
description: 用于沉淀个人研究框架和输出格式
---

# 我的投研 Skill

请按我的研究框架输出：

- 核心判断
- 关键证据
- 反向风险
- 后续跟踪项
`;

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  const headingId = useId();
  const options = [
    { value: "light" as const, label: "亮色", icon: SunIcon },
    { value: "dark" as const, label: "暗色", icon: MoonIcon },
  ];

  return (
    <section
      className="app-panel min-w-0 overflow-hidden"
      aria-labelledby={headingId}
    >
      <header className="border-b border-[var(--app-border-soft)] px-5 py-5 sm:px-6">
        <h2
          id={headingId}
          className="text-xl font-medium text-[var(--app-text-strong)]"
        >
          外观
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
          选择工作台使用的显示模式。
        </p>
      </header>
      <div className="grid grid-cols-2 gap-2 px-5 py-5 sm:px-6">
        {options.map((option) => {
          const Icon = option.icon;
          const active = theme === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              className={`flex h-11 items-center justify-center gap-2 rounded-[8px] border text-sm font-medium transition-colors ${
                active
                  ? "border-[var(--app-primary-border)] bg-[var(--app-primary-surface)] text-[var(--app-on-primary)]"
                  : "border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] text-[var(--app-text-muted)] hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
              }`}
              onClick={() => setTheme(option.value)}
            >
              <Icon className="h-[18px] w-[18px]" />
              {option.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function UserSkillManager() {
  const utils = api.useUtils();
  const skillsQuery = api.agentRuntime.listMySkills.useQuery();
  const [content, setContent] = useState(EMPTY_SKILL_TEMPLATE);
  const [editingSkill, setEditingSkill] = useState<UserSkill | null>(null);
  const createSkill = api.agentRuntime.createSkill.useMutation({
    onSuccess: async () => {
      setContent(EMPTY_SKILL_TEMPLATE);
      await Promise.all([
        utils.agentRuntime.listMySkills.invalidate(),
        utils.agentRuntime.listSkills.invalidate(),
      ]);
    },
  });
  const updateSkill = api.agentRuntime.updateSkill.useMutation({
    onSuccess: async () => {
      setEditingSkill(null);
      setContent(EMPTY_SKILL_TEMPLATE);
      await Promise.all([
        utils.agentRuntime.listMySkills.invalidate(),
        utils.agentRuntime.listSkills.invalidate(),
      ]);
    },
  });
  const setEnabled = api.agentRuntime.setSkillEnabled.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.agentRuntime.listMySkills.invalidate(),
        utils.agentRuntime.listSkills.invalidate(),
      ]);
    },
  });
  const deleteSkill = api.agentRuntime.deleteSkill.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.agentRuntime.listMySkills.invalidate(),
        utils.agentRuntime.listSkills.invalidate(),
      ]);
    },
  });
  const busy =
    createSkill.isPending ||
    updateSkill.isPending ||
    setEnabled.isPending ||
    deleteSkill.isPending;
  const mutationError =
    createSkill.error?.message ||
    updateSkill.error?.message ||
    setEnabled.error?.message ||
    deleteSkill.error?.message;

  return (
    <section className="app-panel min-w-0 overflow-hidden">
      <header className="border-b border-[var(--app-border-soft)] px-5 py-5 sm:px-6">
        <h2 className="text-xl font-medium text-[var(--app-text-strong)]">
          我的 Skill
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
          上传个人 Markdown 投研框架，在投研智能体中与内置 Skill 混合使用。
        </p>
      </header>
      <div className="grid gap-5 px-5 py-5 sm:px-6">
        <textarea
          className="min-h-[300px] w-full resize-y rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-3 font-mono text-xs leading-5 text-[var(--app-text)] outline-none focus:border-[var(--app-primary-border)]"
          value={content}
          spellCheck={false}
          onChange={(event) => setContent(event.target.value)}
        />
        {mutationError ? (
          <div className="text-sm text-[var(--app-danger)]">
            {mutationError}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          {editingSkill ? (
            <button
              type="button"
              className="app-button"
              disabled={busy}
              onClick={() => {
                setEditingSkill(null);
                setContent(EMPTY_SKILL_TEMPLATE);
              }}
            >
              取消编辑
            </button>
          ) : null}
          <button
            type="button"
            className="app-button app-button-primary inline-flex items-center gap-2"
            disabled={busy || !content.trim()}
            onClick={() => {
              if (editingSkill) {
                updateSkill.mutate({
                  skillId: editingSkill.userSkillId,
                  content,
                });
                return;
              }
              createSkill.mutate({ content, filename: "SKILL.md" });
            }}
          >
            {editingSkill ? (
              <Save className="h-4 w-4" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {editingSkill ? "保存新版本" : "上传 Skill"}
          </button>
        </div>
        <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
          {(skillsQuery.data ?? []).map((skill) => (
            <div
              key={skill.userSkillId}
              className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-base font-medium text-[var(--app-text-strong)]">
                    {skill.name}
                  </h3>
                  <span className="rounded-[8px] border border-[var(--app-border-soft)] px-2 py-1 text-xs text-[var(--app-text-muted)]">
                    v{skill.version}
                  </span>
                  <span className="rounded-[8px] border border-[var(--app-border-soft)] px-2 py-1 text-xs text-[var(--app-text-muted)]">
                    {skill.enabled ? "已启用" : "已停用"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--app-text-muted)]">
                  {skill.description}
                </p>
                <p className="mt-2 text-xs text-[var(--app-text-subtle)]">
                  更新于 {new Date(skill.updatedAt).toLocaleString("zh-CN")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  className="app-button"
                  disabled={busy}
                  onClick={() => {
                    setEditingSkill(skill);
                    setContent(skill.content);
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="app-button inline-flex items-center gap-2"
                  disabled={busy}
                  onClick={() =>
                    setEnabled.mutate({
                      skillId: skill.userSkillId,
                      enabled: !skill.enabled,
                    })
                  }
                >
                  <Power className="h-4 w-4" />
                  {skill.enabled ? "停用" : "启用"}
                </button>
                <button
                  type="button"
                  className="app-button inline-flex items-center gap-2"
                  disabled={busy}
                  onClick={() =>
                    deleteSkill.mutate({ skillId: skill.userSkillId })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  删除
                </button>
              </div>
            </div>
          ))}
          {!skillsQuery.isLoading && (skillsQuery.data ?? []).length === 0 ? (
            <div className="py-6 text-sm text-[var(--app-text-muted)]">
              暂无自定义 Skill。
            </div>
          ) : null}
          {skillsQuery.isLoading ? (
            <div className="py-6 text-sm text-[var(--app-text-muted)]">
              正在加载
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function SettingsClient() {
  const accountSecurityHeadingId = useId();

  return (
    <WorkspaceShell
      section="settings"
      title="设置"
      description="管理个性化研究关注与账号凭据。"
      showHistory={false}
      contentWidth="wide"
    >
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-6">
          <ResearchPreferenceImportPanel />
          <ResearchRadarPanel />
          <UserSkillManager />
        </div>

        <div className="grid gap-6">
          <AppearanceSettings />
          <section
            className="app-panel min-w-0 overflow-hidden"
            aria-labelledby={accountSecurityHeadingId}
          >
            <header className="border-b border-[var(--app-border-soft)] px-5 py-5 sm:px-6">
              <h2
                id={accountSecurityHeadingId}
                className="text-xl font-medium text-[var(--app-text-strong)]"
              >
                账号安全
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                更新登录密码，保护研究工作台访问权限。
              </p>
            </header>
            <div className="px-5 py-5 sm:px-6">
              <h3 className="mb-5 text-base font-medium text-[var(--app-text-strong)]">
                修改密码
              </h3>
              <ChangePasswordForm />
            </div>
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}

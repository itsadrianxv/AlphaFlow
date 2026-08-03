import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { truncateText } from "./json";
import type { WebInternalClient } from "./web-internal-client";

export const SCHEDULED_TASK_SETUP_TOOL_NAMES = [
	"list_schedule_capabilities",
	"inspect_schedule_capability",
	"validate_schedule",
	"resolve_user_scope",
	"build_scheduled_task_draft",
	"build_scheduled_task_edit_draft",
] as const;

type Options = {
	webInternalClient: WebInternalClient;
	runId: string;
	userId: string;
	conversationId: string;
	timeoutMs: number;
};

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new Error("定时任务工具调用超时")),
		timeoutMs,
	);
	const abort = () => controller.abort(signal?.reason);
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		},
	};
}

function result(details: unknown): AgentToolResult<Record<string, unknown>> {
	const record =
		details && typeof details === "object"
			? (details as Record<string, unknown>)
			: { value: details };
	return {
		content: [
			{
				type: "text",
				text: truncateText(JSON.stringify(record, null, 2), 10000),
			},
		],
		details: record,
	};
}

export function createScheduledTaskSetupTools(options: Options): AgentTool[] {
	const call = async (
		operation: string,
		toolCallId: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => {
		const timeout = withTimeout(signal, options.timeoutMs);
		try {
			const details =
				await options.webInternalClient.postScheduledTaskSetupOperation(
					{
						operation,
						runId: options.runId,
						userId: options.userId,
						conversationId: options.conversationId,
						idempotencyKey: `${options.runId}:${toolCallId}`,
						params,
					},
					timeout.signal,
				);
			return result(details);
		} finally {
			timeout.cleanup();
		}
	};
	return [
		{
			name: "list_schedule_capabilities",
			label: "列出定时任务能力",
			description: "列出可用于定时执行的数据能力。",
			parameters: Type.Object({
				provider: Type.Optional(Type.String()),
				query: Type.Optional(Type.String()),
			}),
			execute: (id, params, signal) =>
				call(
					"list_schedule_capabilities",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
		{
			name: "inspect_schedule_capability",
			label: "检查定时任务能力",
			description: "读取指定能力的参数、限制和文档信息。",
			parameters: Type.Object({ capability: Type.String({ minLength: 1 }) }),
			execute: (id, params, signal) =>
				call(
					"inspect_schedule_capability",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
		{
			name: "validate_schedule",
			label: "验证定时任务",
			description: "验证时间、数据源、输出与投递设置并生成规范化结果。",
			parameters: Type.Object({
				draft: Type.Record(Type.String(), Type.Any()),
			}),
			execute: (id, params, signal) =>
				call(
					"validate_schedule",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
		{
			name: "resolve_user_scope",
			label: "读取用户范围",
			description: "读取用户可引用的自选股、研究对象、时区和投递目标别名。",
			parameters: Type.Object({
				include: Type.Optional(Type.Array(Type.String())),
			}),
			execute: (id, params, signal) =>
				call(
					"resolve_user_scope",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
		{
			name: "build_scheduled_task_draft",
			label: "保存定时任务草稿",
			description: "将已经验证的规范化任务保存为 DRAFT 版本，不会激活任务。",
			parameters: Type.Object({
				validatedDraft: Type.Optional(Type.Record(Type.String(), Type.Any())),
				changeSet: Type.Optional(Type.Record(Type.String(), Type.Any())),
			}),
			execute: (id, params, signal) =>
				call(
					"build_scheduled_task_draft",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
		{
			name: "build_scheduled_task_edit_draft",
			label: "保存任务修改预览",
			description: "保存已经验证的任务修改候选，不会覆盖当前正式版本。",
			parameters: Type.Object({
				validatedDraft: Type.Record(Type.String(), Type.Any()),
			}),
			execute: (id, params, signal) =>
				call(
					"build_scheduled_task_edit_draft",
					id,
					params as Record<string, unknown>,
					signal,
				),
		},
	];
}

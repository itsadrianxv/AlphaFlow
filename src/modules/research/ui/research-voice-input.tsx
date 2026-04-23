"use client";

// biome-ignore lint/correctness/noUnusedImports: React must remain in scope for JSX in this environment.
import React, { useState } from "react";
import type {
  ResearchVoiceContext,
  ResearchVoiceFieldPatch,
  ResearchVoiceIntakeResponse,
} from "~/modules/research/contracts/voice";
import {
  type UseResearchVoiceRecorderOptions,
  useResearchVoiceRecorder,
} from "~/modules/research/ui/use-research-voice-recorder";

type ResearchVoiceInputProps = {
  context: ResearchVoiceContext;
  onApplyPatch: (
    patch: ResearchVoiceFieldPatch,
    response: ResearchVoiceIntakeResponse,
  ) => void;
  endpoint?: string;
  recorderOptions?: UseResearchVoiceRecorderOptions;
};

function buildErrorMessage(errorCode: string | null) {
  if (errorCode === "permission_denied") {
    return "麦克风权限被拒绝，请检查浏览器设置";
  }

  if (errorCode === "recording_failed") {
    return "语音录制失败，请重试";
  }

  return null;
}

export function ResearchVoiceInput(props: ResearchVoiceInputProps) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const recorder = useResearchVoiceRecorder({
    ...props.recorderOptions,
    onRecordingComplete: async ({ blob }) => {
      setIsSubmitting(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const formData = new FormData();
        formData.append("audio", blob, "research-voice.webm");
        formData.append("context", JSON.stringify(props.context));

        const response = await fetch(
          props.endpoint ?? "/api/voice/research-intake",
          {
            method: "POST",
            body: formData,
          },
        );
        const payload =
          (await response.json()) as ResearchVoiceIntakeResponse & {
            message?: string;
          };

        if (!response.ok) {
          throw new Error(payload.message ?? "语音整理失败");
        }

        props.onApplyPatch(payload.appliedPatch, payload);
        setStatusMessage(
          payload.degradedToPrimaryOnly
            ? "已填入语音整理结果，其它字段未自动应用"
            : "已应用语音整理结果",
        );
      } catch (error) {
        setErrorMessage((error as Error).message);
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  const recorderErrorMessage = buildErrorMessage(recorder.errorCode);
  const capabilityNotice = !recorder.isSupported
    ? "当前浏览器不支持语音输入"
    : null;
  const buttonLabel = recorder.isRecording
    ? "结束录音"
    : isSubmitting
      ? "正在转写"
      : "开始语音输入";

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setErrorMessage(null);
            setStatusMessage(null);
            if (recorder.isRecording) {
              void recorder.stopRecording();
              return;
            }

            void recorder.startRecording();
          }}
          disabled={!recorder.isSupported || isSubmitting}
          className="app-button"
        >
          {buttonLabel}
        </button>
        <span className="text-sm text-[var(--app-text-muted)]">
          点击开始，语音结束后会自动整理并填入表单
        </span>
      </div>

      {capabilityNotice ? (
        <div className="text-sm text-[var(--app-text-muted)]">
          {capabilityNotice}
        </div>
      ) : null}
      {recorderErrorMessage ? (
        <div className="text-sm text-[var(--app-danger)]">
          {recorderErrorMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="text-sm text-[var(--app-danger)]">{errorMessage}</div>
      ) : null}
      {statusMessage ? (
        <div className="text-sm text-[var(--app-text-muted)]">
          {statusMessage}
        </div>
      ) : null}
    </div>
  );
}

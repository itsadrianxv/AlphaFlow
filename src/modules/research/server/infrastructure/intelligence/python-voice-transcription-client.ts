import {
  type ResearchVoiceContext,
  type ResearchVoicePageKind,
  voiceTranscriptionResponseSchema,
} from "~/modules/research/contracts/voice";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/modules/research/server/domain/workflow/errors";
import { env } from "~/platform/env";

type VoiceGatewayErrorResponse = {
  error?: {
    message?: string;
  };
  detail?: {
    message?: string;
  };
};

function resolveVoiceServiceBasePath(rawBaseUrl: string) {
  const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");

  if (normalizedBaseUrl.endsWith("/api/v1/voice")) {
    const baseUrl = normalizedBaseUrl.replace(/\/voice$/, "");
    return {
      baseUrl,
      voiceBasePath: "/voice",
    };
  }

  if (normalizedBaseUrl.endsWith("/api/v1")) {
    return {
      baseUrl: normalizedBaseUrl,
      voiceBasePath: "/voice",
    };
  }

  if (normalizedBaseUrl.endsWith("/api")) {
    return {
      baseUrl: normalizedBaseUrl,
      voiceBasePath: "/v1/voice",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    voiceBasePath: "/api/v1/voice",
  };
}

export type PythonVoiceTranscriptionClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

export class PythonVoiceTranscriptionClient {
  private readonly baseUrl: string;
  private readonly voiceBasePath: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonVoiceTranscriptionClientConfig) {
    const resolvedBaseUrl = resolveVoiceServiceBasePath(
      config?.baseUrl ?? env.PYTHON_INTELLIGENCE_SERVICE_URL,
    );

    this.baseUrl = resolvedBaseUrl.baseUrl;
    this.voiceBasePath = resolvedBaseUrl.voiceBasePath;
    this.timeoutMs = config?.timeoutMs ?? env.VOICE_TRANSCRIBE_TIMEOUT_MS;
  }

  async transcribe(params: {
    audioBytes: Uint8Array;
    fileName: string;
    mimeType: string;
    pageKind: ResearchVoicePageKind;
    dynamicHotwords: ResearchVoiceContext["currentFields"];
    starterExamples: string[];
  }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const formData = new FormData();
      const audioBuffer = params.audioBytes.slice().buffer;
      formData.append(
        "audio",
        new Blob([audioBuffer], {
          type: params.mimeType,
        }),
        params.fileName,
      );
      formData.append("pageKind", params.pageKind);
      formData.append(
        "dynamicHotwords",
        JSON.stringify(params.dynamicHotwords),
      );
      formData.append(
        "starterExamples",
        JSON.stringify(params.starterExamples),
      );

      const response = await fetch(
        `${this.baseUrl}${this.voiceBasePath}/transcribe`,
        {
          method: "POST",
          body: formData,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const responseText = await response.text().catch(() => "Unknown error");
        let errorMessage = responseText;

        try {
          const payload = JSON.parse(responseText) as VoiceGatewayErrorResponse;
          errorMessage =
            payload.detail?.message ?? payload.error?.message ?? responseText;
        } catch {
          errorMessage = responseText;
        }

        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Voice transcription service error(${response.status}): ${errorMessage}`,
        );
      }

      const payload = await response.json();
      return voiceTranscriptionResponseSchema.parse(payload);
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Voice transcription request timed out (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Voice transcription request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

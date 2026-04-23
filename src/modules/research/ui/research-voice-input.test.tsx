// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
// biome-ignore lint/correctness/noUnusedImports: React must remain in scope for JSX in this test environment.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchVoiceInput } from "~/modules/research/ui/research-voice-input";

class FakeMediaRecorder {
  public static latest: FakeMediaRecorder | null = null;
  public static isTypeSupported(mimeType: string) {
    return mimeType === "audio/webm;codecs=opus";
  }
  public state: "inactive" | "recording" = "inactive";
  public ondataavailable: ((event: { data: Blob }) => void) | null = null;
  public onstop: (() => void) | null = null;

  constructor(
    public readonly stream: MediaStream,
    public readonly options?: { mimeType?: string },
  ) {
    FakeMediaRecorder.latest = this;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({
      data: new Blob(["voice-data"], {
        type: this.options?.mimeType ?? "audio/webm",
      }),
    });
    this.onstop?.();
  }
}

function createMockStream(): MediaStream {
  return {
    getTracks: () =>
      [
        {
          stop: vi.fn(),
        },
      ] as never,
  } as unknown as MediaStream;
}

function createContext(pageKind: "quick_research" | "company_research") {
  return {
    pageKind,
    currentFields:
      pageKind === "quick_research"
        ? {
            query: "旧问题",
          }
        : {
            keyQuestion: "旧问题",
            companyName: "贵州茅台",
            stockCode: "600519",
          },
    starterExamples: ["样例一"],
  };
}

describe("ResearchVoiceInput", () => {
  const fetchMock = vi.fn();
  let vadCallbacks: Array<() => void> = [];

  beforeEach(() => {
    vadCallbacks = [];
    FakeMediaRecorder.latest = null;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as never);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => createMockStream()),
      },
    });
    vi.stubGlobal("window", window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("transitions through recording and applies the returned patch after a manual stop", async () => {
    const onApplyPatch = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        normalizedPrimaryText: "新问题",
        appliedPatch: { query: "新问题" },
        appliedFieldKeys: ["query"],
        confidenceLevel: "high",
        degradedToPrimaryOnly: false,
        source: { durationMs: 800, overallConfidence: 0.92 },
      }),
    });

    render(
      <ResearchVoiceInput
        context={createContext("quick_research")}
        onApplyPatch={onApplyPatch}
        recorderOptions={{
          vadFactory: async ({ onSpeechEnd }) => {
            vadCallbacks.push(onSpeechEnd);
            return {
              start: vi.fn(),
              pause: vi.fn(),
              destroy: vi.fn(),
            };
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    expect(
      await screen.findByRole("button", { name: "结束录音" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "结束录音" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(onApplyPatch).toHaveBeenCalledWith(
        { query: "新问题" },
        expect.objectContaining({
          normalizedPrimaryText: "新问题",
        }),
      );
    });
    expect(screen.getByText("已应用语音整理结果")).toBeTruthy();
  });

  it("stops recording when VAD detects speech end", async () => {
    const onApplyPatch = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        normalizedPrimaryText: "利润修复是否可持续",
        appliedPatch: { keyQuestion: "利润修复是否可持续" },
        appliedFieldKeys: ["keyQuestion"],
        confidenceLevel: "medium",
        degradedToPrimaryOnly: true,
        source: { durationMs: 900, overallConfidence: 0.8 },
      }),
    });

    render(
      <ResearchVoiceInput
        context={createContext("company_research")}
        onApplyPatch={onApplyPatch}
        recorderOptions={{
          vadFactory: async ({ onSpeechEnd }) => {
            vadCallbacks.push(onSpeechEnd);
            return {
              start: vi.fn(),
              pause: vi.fn(),
              destroy: vi.fn(),
            };
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    await waitFor(() => expect(vadCallbacks.length).toBe(1));

    vadCallbacks[0]?.();

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(onApplyPatch).toHaveBeenCalled();
    });
  });

  it("shows the low-confidence inline notice when only the primary field is applied", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        normalizedPrimaryText: "新问题",
        appliedPatch: { query: "新问题" },
        appliedFieldKeys: ["query"],
        confidenceLevel: "low",
        degradedToPrimaryOnly: true,
        source: { durationMs: 800, overallConfidence: 0.7 },
      }),
    });

    render(
      <ResearchVoiceInput
        context={createContext("quick_research")}
        onApplyPatch={vi.fn()}
        recorderOptions={{
          vadFactory: async () => ({
            start: vi.fn(),
            pause: vi.fn(),
            destroy: vi.fn(),
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));
    fireEvent.click(await screen.findByRole("button", { name: "结束录音" }));

    expect(
      await screen.findByText("已填入语音整理结果，其它字段未自动应用"),
    ).toBeTruthy();
  });

  it("shows a permission message when microphone access is denied", async () => {
    const deniedError = new DOMException(
      "Permission denied",
      "NotAllowedError",
    );
    const getUserMedia = vi.fn(async () => {
      throw deniedError;
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia,
      },
    });

    render(
      <ResearchVoiceInput
        context={createContext("quick_research")}
        onApplyPatch={vi.fn()}
        recorderOptions={{
          vadFactory: async () => ({
            start: vi.fn(),
            pause: vi.fn(),
            destroy: vi.fn(),
          }),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "开始语音输入" }));

    expect(
      await screen.findByText("麦克风权限被拒绝，请检查浏览器设置"),
    ).toBeTruthy();
  });

  it("fails closed when browser recording APIs are unavailable", () => {
    vi.unstubAllGlobals();
    render(
      <ResearchVoiceInput
        context={createContext("quick_research")}
        onApplyPatch={vi.fn()}
        recorderOptions={{
          mediaDevices: undefined,
          mediaRecorderCtor: undefined,
          vadFactory: async () => ({
            start: vi.fn(),
            pause: vi.fn(),
            destroy: vi.fn(),
          }),
        }}
      />,
    );

    expect(screen.getByText("当前浏览器不支持语音输入")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "开始语音输入" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});

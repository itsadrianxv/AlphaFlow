"use client";

import { useEffect, useRef, useState } from "react";

type VadController = {
  start(): Promise<void> | void;
  pause?(): Promise<void> | void;
  destroy?(): Promise<void> | void;
};

export type UseResearchVoiceRecorderOptions = {
  maxDurationMs?: number;
  mediaDevices?: Pick<MediaDevices, "getUserMedia">;
  mediaRecorderCtor?: typeof MediaRecorder;
  vadFactory?: (params: { onSpeechEnd: () => void }) => Promise<VadController>;
  onRecordingComplete?: (params: { blob: Blob; mimeType: string }) => void;
};

type RecorderErrorCode =
  | "permission_denied"
  | "unsupported_browser"
  | "recording_failed"
  | null;

function getRecorderMimeType(mediaRecorderCtor: typeof MediaRecorder) {
  if (typeof mediaRecorderCtor.isTypeSupported === "function") {
    if (mediaRecorderCtor.isTypeSupported("audio/webm;codecs=opus")) {
      return "audio/webm;codecs=opus";
    }

    if (mediaRecorderCtor.isTypeSupported("audio/webm")) {
      return "audio/webm";
    }
  }

  return "audio/webm";
}

async function defaultVadFactory(params: { onSpeechEnd: () => void }) {
  const { MicVAD } = await import("@ricky0123/vad-web");
  return MicVAD.new({
    onSpeechEnd: () => {
      params.onSpeechEnd();
    },
  }) as Promise<VadController>;
}

function stopStreamTracks(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function useResearchVoiceRecorder(
  options?: UseResearchVoiceRecorderOptions,
) {
  const mediaDevices =
    options?.mediaDevices ??
    (typeof navigator !== "undefined" ? navigator.mediaDevices : undefined);
  const mediaRecorderCtor =
    options?.mediaRecorderCtor ??
    (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  const vadFactory = options?.vadFactory ?? defaultVadFactory;
  const maxDurationMs = options?.maxDurationMs ?? 90_000;
  const onRecordingComplete = options?.onRecordingComplete;

  const [isSupported, setIsSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [errorCode, setErrorCode] = useState<RecorderErrorCode>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const vadRef = useRef<VadController | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    const supported = Boolean(mediaDevices?.getUserMedia && mediaRecorderCtor);
    setIsSupported(supported);
    if (!supported) {
      setErrorCode("unsupported_browser");
    }
  }, [mediaDevices, mediaRecorderCtor]);

  const cleanupResources = async () => {
    if (stopTimeoutRef.current !== null) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    if (vadRef.current) {
      await vadRef.current.pause?.();
      await vadRef.current.destroy?.();
      vadRef.current = null;
    }

    stopStreamTracks(mediaStreamRef.current);
    mediaStreamRef.current = null;
  };

  const stopRecording = async () => {
    if (!mediaRecorderRef.current || stopRequestedRef.current) {
      return;
    }

    stopRequestedRef.current = true;
    await cleanupResources();
    mediaRecorderRef.current.stop();
  };

  const startRecording = async () => {
    if (!mediaDevices?.getUserMedia || !mediaRecorderCtor) {
      setErrorCode("unsupported_browser");
      return;
    }

    try {
      recordedChunksRef.current = [];
      stopRequestedRef.current = false;
      setErrorCode(null);

      const stream = await mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType(mediaRecorderCtor);
      const recorder = new mediaRecorderCtor(stream, { mimeType });

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, {
          type: mimeType,
        });
        void cleanupResources();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        stopRequestedRef.current = false;
        setIsRecording(false);

        if (blob.size === 0) {
          setErrorCode("recording_failed");
          return;
        }

        onRecordingComplete?.({ blob, mimeType });
      };

      vadRef.current = await vadFactory({
        onSpeechEnd: () => {
          void stopRecording();
        },
      });
      await vadRef.current.start();
      recorder.start();
      setIsRecording(true);

      stopTimeoutRef.current = window.setTimeout(() => {
        void stopRecording();
      }, maxDurationMs);
    } catch (error) {
      await cleanupResources();
      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      setIsRecording(false);

      if ((error as Error).name === "NotAllowedError") {
        setErrorCode("permission_denied");
        return;
      }

      setErrorCode("recording_failed");
    }
  };

  return {
    isSupported,
    isRecording,
    errorCode,
    startRecording,
    stopRecording,
  };
}

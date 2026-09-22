"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Mic, Pause, Play, X } from "lucide-react";

import { formatDuration, formatBytes, type AttachmentKind } from "@/lib/uploads";
import type { MessageAttachment } from "@/lib/messages";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- reading */

/** A photo in the thread. Full size opens in a new tab; the bubble stays small. */
function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 text-[13px] underline"
      >
        <Download className="size-4" />
        {attachment.filename || "Photo"}
      </a>
    );
  }

  return (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- the src is a
          short-lived signed URL on a bucket the image optimiser cannot reach. */}
      <img
        src={attachment.url}
        alt={attachment.filename || "Photo"}
        onError={() => setBroken(true)}
        className="max-h-64 w-auto max-w-full rounded-xl object-cover"
      />
    </a>
  );
}

/**
 * A voice note.
 *
 * Its own transport rather than <audio controls>, because the native player is
 * a different size and colour in every browser and this sits inside a coloured
 * bubble. One element plays at a time by construction: each player owns its
 * own audio element and pauses on unmount.
 */
function VoiceAttachment({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const total = attachment.durationMs ?? 0;

  useEffect(() => {
    const element = audio.current;
    return () => element?.pause();
  }, []);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  const progress = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;

  return (
    <div className="flex min-w-[13rem] items-center gap-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
          "bg-chat-accent text-white hover:bg-chat-accent-strong",
        )}
      >
        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
      </button>

      <div className="min-w-0 flex-1">
        <div className={cn("h-1.5 w-full rounded-full", mine ? "bg-chat-accent/25" : "bg-ink-300/60")}>
          <div
            className="h-full rounded-full bg-chat-accent transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className={cn("mt-1 text-[11px] tabular-nums", mine ? "text-chat-mine-meta" : "text-ink-500")}>
          {formatDuration(elapsed)} / {total ? formatDuration(total) : formatBytes(attachment.size)}
        </p>
      </div>

      <audio
        ref={audio}
        src={attachment.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setElapsed(0);
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime * 1000)}
      />
    </div>
  );
}

export function MessageAttachmentView({
  attachment,
  mine,
}: {
  attachment: MessageAttachment;
  mine: boolean;
}) {
  return attachment.kind === "image" ? (
    <ImageAttachment attachment={attachment} />
  ) : (
    <VoiceAttachment attachment={attachment} mine={mine} />
  );
}

/* -------------------------------------------------------------- writing */

export type Draft = {
  kind: AttachmentKind;
  file: Blob;
  filename: string;
  /** Local object URL, for the preview only. */
  previewUrl: string;
  durationMs?: number;
};

/** What is about to be sent, with a way to change your mind. */
export function DraftPreview({
  draft,
  percent,
  onRemove,
}: {
  draft: Draft;
  /** 0-100 while uploading, null when idle. */
  percent: number | null;
  onRemove: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-field border border-line bg-ink-50 p-2">
      {draft.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
        <img src={draft.previewUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-chat-accent-soft text-chat-accent-strong">
          <Mic className="size-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-ink-800">
          {draft.kind === "image" ? draft.filename || "Photo" : "Voice note"}
        </p>
        <p className="text-[11px] text-ink-500">
          {draft.durationMs ? `${formatDuration(draft.durationMs)} · ` : ""}
          {formatBytes(draft.file.size)}
        </p>

        {percent !== null && (
          <div className="mt-1.5 h-1 w-full rounded-full bg-ink-200">
            <div
              className="h-full rounded-full bg-chat-accent transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={percent !== null}
        aria-label="Remove attachment"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-200 hover:text-ink-700 disabled:opacity-40"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ recording */

type Recorder = {
  supported: boolean;
  recording: boolean;
  /** Milliseconds captured so far. */
  elapsed: number;
  start: () => Promise<void>;
  /** Stops and hands back what was recorded, or null if nothing usable. */
  stop: () => Promise<Draft | null>;
  cancel: () => void;
  error: string;
};

/** The first of these the browser can actually encode is used. */
const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];

/**
 * Records a voice note from the microphone.
 *
 * The track is stopped on every exit path, including unmount: a page that
 * leaves the microphone open shows a recording indicator in the browser tab
 * long after the user has moved on.
 */
export function useVoiceRecorder(): Recorder {
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");

  const supported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);

  const release = useCallback(() => {
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
    setRecording(false);
  }, []);

  useEffect(() => release, [release]);

  // A ticking clock while recording, so the length is visible as it grows.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Date.now() - startedAt.current), 200);
    return () => clearInterval(timer);
  }, [recording]);

  const start = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = AUDIO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));

      const instance = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      instance.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.current.push(event.data);
      };

      recorder.current = instance;
      startedAt.current = Date.now();
      setElapsed(0);
      instance.start();
      setRecording(true);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser to record."
          : "No microphone is available.",
      );
      release();
    }
  }, [release]);

  const stop = useCallback(async () => {
    const instance = recorder.current;
    if (!instance) return null;

    const durationMs = Date.now() - startedAt.current;

    const blob = await new Promise<Blob>((resolve) => {
      instance.onstop = () => {
        // The recorder's own type carries the codec; the bare type is what the
        // API validates against.
        const type = (instance.mimeType || "audio/webm").split(";")[0];
        resolve(new Blob(chunks.current, { type }));
      };
      instance.stop();
    });

    release();

    // Anything under a second is a slip of the finger, not a message.
    if (blob.size === 0 || durationMs < 700) return null;

    return {
      kind: "voice" as const,
      file: blob,
      filename: `voice-note.${blob.type.includes("mp4") ? "m4a" : "webm"}`,
      previewUrl: URL.createObjectURL(blob),
      durationMs,
    };
  }, [release]);

  const cancel = useCallback(() => {
    const instance = recorder.current;
    if (instance && instance.state !== "inactive") {
      instance.onstop = null;
      instance.stop();
    }
    chunks.current = [];
    release();
  }, [release]);

  return { supported, recording, elapsed, start, stop, cancel, error };
}

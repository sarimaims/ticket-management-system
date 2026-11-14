"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Film,
  Mic,
  Pause,
  Play,
  Presentation,
  X,
} from "lucide-react";

import { formatDuration, formatBytes, type AttachmentKind } from "@/lib/uploads";
import type { MessageAttachment } from "@/lib/messages";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- reading */

/**
 * A photo opened at full size, over everything else.
 *
 * Portalled to the body rather than rendered where it was clicked: the thread
 * scrolls and clips, and a picture that has to fit inside its own message is
 * not what "full size" means. The original is still one click further on, for
 * saving it or reading something too small to make out here.
 */
export function PhotoLightbox({
  src,
  alt,
  onClose,
  onPrev,
  onNext,
  position,
  footer,
}: {
  src: string;
  alt: string;
  /**
   * What sits under the photo instead of the plain "Open original" link: the
   * attachments library puts the ticket it came from there, with its actions.
   */
  footer?: React.ReactNode;
  onClose: () => void;
  /** Given when there is a set to step through; the arrows and keys appear with them. */
  onPrev?: () => void;
  onNext?: () => void;
  /** "2 / 5", shown at the top when stepping through a set. */
  position?: string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onPrev?.();
      else if (event.key === "ArrowRight") onNext?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onPrev, onNext]);

  /** The arrows sit on the dark around the photo; a click on them is not a click to close. */
  const step = (go?: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    go?.();
  };
  const arrow =
    "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-ink-900/60 text-white transition-colors hover:bg-ink-900 disabled:pointer-events-none disabled:opacity-30";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[60] grid place-items-center bg-ink-900/80 p-4 sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 grid size-9 place-items-center rounded-full bg-ink-900/60 text-white transition-colors hover:bg-ink-900"
      >
        <X className="size-5" />
      </button>

      {position && (
        <span className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-ink-900/60 px-3 py-1 text-[12px] font-semibold text-white tabular-nums">
          {position}
        </span>
      )}

      {(onPrev || onNext) && (
        <>
          <button
            type="button"
            onClick={step(onPrev)}
            disabled={!onPrev}
            aria-label="Previous photo"
            className={cn(arrow, "left-3 sm:left-5")}
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={step(onNext)}
            disabled={!onNext}
            aria-label="Next photo"
            className={cn(arrow, "right-3 sm:right-5")}
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element -- the src is a
          short-lived signed URL on a bucket the image optimiser cannot reach. */}
      <img
        src={src}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] max-w-[calc(100%-7rem)] rounded-lg object-contain shadow-2xl"
      />

      {footer ? (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute inset-x-0 bottom-4 mx-auto w-fit max-w-[calc(100%-2rem)]"
        >
          {footer}
        </div>
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="absolute inset-x-0 bottom-4 mx-auto inline-flex w-fit items-center gap-1.5 rounded-full bg-ink-900/60 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-ink-900"
        >
          <ExternalLink className="size-3.5" />
          Open original
        </a>
      )}
    </div>,
    document.body,
  );
}

/** A photo in the thread. The bubble stays small; a click opens it over the page. */
function ImageAttachment({ attachment }: { attachment: MessageAttachment }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);

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
    <>
      <button type="button" onClick={() => setOpen(true)} className="block cursor-zoom-in">
        {/* eslint-disable-next-line @next/next/no-img-element -- the src is a
            short-lived signed URL on a bucket the image optimiser cannot reach. */}
        <img
          src={attachment.url}
          alt={attachment.filename || "Photo"}
          onError={() => setBroken(true)}
          className="max-h-52 w-auto max-w-full rounded-xl object-cover"
        />
      </button>

      {open && (
        <PhotoLightbox
          src={attachment.url}
          alt={attachment.filename || "Photo"}
          onClose={() => setOpen(false)}
        />
      )}
    </>
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

/**
 * A video in the thread, playable where it sits.
 *
 * The native player this time: unlike a voice note, a video's controls are
 * overlaid on the picture rather than sitting in the bubble's colour, and
 * every browser's player already does scrubbing, volume and full screen.
 * `preload="metadata"` fetches the first frame and the length, not the film.
 */
function VideoAttachment({ attachment }: { attachment: MessageAttachment }) {
  return (
    <video
      src={attachment.url}
      controls
      preload="metadata"
      playsInline
      className="max-h-64 w-full max-w-xs rounded-xl bg-ink-900"
      aria-label={attachment.filename || "Video"}
    />
  );
}

/**
 * The icon a document wears, from what it actually is.
 *
 * A component that picks, rather than a function that hands back a component:
 * choosing a component during render and then rendering it is what React
 * cannot keep stable between renders.
 */
export function DocumentIcon({
  mimeType,
  filename,
  className,
}: {
  mimeType: string;
  filename: string;
  className?: string;
}) {
  const name = filename.toLowerCase();
  if (/sheet|excel|csv/.test(mimeType) || /\.(xlsx?|ods|csv)$/.test(name)) {
    return <FileSpreadsheet className={className} />;
  }
  if (/presentation|powerpoint/.test(mimeType) || /\.(pptx?|odp)$/.test(name)) {
    return <Presentation className={className} />;
  }
  if (/zip|rar|7z|compressed/.test(mimeType) || /\.(zip|rar|7z)$/.test(name)) {
    return <FileArchive className={className} />;
  }
  return <FileText className={className} />;
}

/** The extension as a label, the way a phone shows "PDF" on a document. */
export function extensionOf(filename: string) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toUpperCase().slice(0, 5) : "FILE";
}

/**
 * A document in the thread: a card with its name, not an icon to guess at.
 *
 * The name is the one it was sent with - "aims-digital-salary-list.xlsx" - so
 * the card says exactly what the sender called it. Opening it goes to a fresh
 * signed link in a new tab, where the browser shows what it can and downloads
 * what it cannot.
 */
function FileAttachment({ attachment, mine }: { attachment: MessageAttachment; mine: boolean }) {
  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "flex min-w-56 max-w-xs items-center gap-2.5 rounded-xl border p-2 transition-colors",
        mine
          ? "border-chat-accent/25 bg-white/50 hover:bg-white/70"
          : "border-line bg-ink-50 hover:bg-ink-100",
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-chat-accent-soft text-chat-accent-strong">
        <DocumentIcon
          mimeType={attachment.mimeType}
          filename={attachment.filename}
          className="size-5"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink-900">
          {attachment.filename || "Document"}
        </span>
        <span className="block text-[11px] text-ink-500">
          {extensionOf(attachment.filename)} · {formatBytes(attachment.size)}
        </span>
      </span>
      <Download className="size-4 shrink-0 text-ink-400" />
    </a>
  );
}

export function MessageAttachmentView({
  attachment,
  mine,
}: {
  attachment: MessageAttachment;
  mine: boolean;
}) {
  switch (attachment.kind) {
    case "image":
      return <ImageAttachment attachment={attachment} />;
    case "video":
      return <VideoAttachment attachment={attachment} />;
    case "file":
      return <FileAttachment attachment={attachment} mine={mine} />;
    default:
      return <VoiceAttachment attachment={attachment} mine={mine} />;
  }
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
  locked = false,
  onRemove,
}: {
  draft: Draft;
  /** 0-100 while uploading, null when idle. */
  percent: number | null;
  /** True while a batch is going out, so none of it can be pulled mid-send. */
  locked?: boolean;
  onRemove: () => void;
}) {
  const fallback = { image: "Photo", video: "Video", file: "Document", voice: "Voice note" }[
    draft.kind
  ];

  return (
    <div className="flex items-center gap-3 rounded-field border border-line bg-ink-50 p-2">
      {draft.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob URL
        <img src={draft.previewUrl} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
      ) : draft.kind === "video" ? (
        // The first frame, muted: enough to recognise the clip before sending.
        <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-ink-900">
          <video src={draft.previewUrl} muted preload="metadata" className="size-full object-cover" />
          <Film className="absolute right-1 bottom-1 size-3.5 text-white drop-shadow" />
        </span>
      ) : (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-chat-accent-soft text-chat-accent-strong">
          {draft.kind === "file" ? (
            <DocumentIcon mimeType={draft.file.type} filename={draft.filename} className="size-5" />
          ) : (
            <Mic className="size-5" />
          )}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {/* The name it will be kept under, so the sender sees what a search
            for it will find later. */}
        <p className="truncate text-[13px] font-semibold text-ink-800">
          {draft.kind === "voice" ? fallback : draft.filename || fallback}
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
        disabled={locked || percent !== null}
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

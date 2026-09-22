import { api, ApiError } from "./api";

/** What a chat can carry. Mirrors the rules the API enforces. */
export type AttachmentKind = "image" | "voice";

export const ATTACHMENT_LIMITS: Record<AttachmentKind, { maxBytes: number; accept: string }> = {
  image: { maxBytes: 10 * 1024 * 1024, accept: "image/jpeg,image/png,image/gif,image/webp" },
  voice: { maxBytes: 15 * 1024 * 1024, accept: "audio/webm,audio/ogg,audio/mpeg,audio/mp4" },
};

type UploadTarget = {
  key: string;
  url: string;
  headers: Record<string, string>;
  expiresIn: number;
};

/**
 * Asks the API where to put one file. The key comes back from the server -
 * the browser never chooses it - and the URL only permits that single object.
 */
export function requestUploadTarget(
  ticketId: string,
  input: { kind: AttachmentKind; contentType: string; size: number; filename?: string },
) {
  return api<UploadTarget>(`/tickets/${ticketId}/messages/upload-url`, {
    method: "POST",
    body: input,
  });
}

/**
 * Sends the bytes straight to S3.
 *
 * XMLHttpRequest rather than fetch, because it reports progress: a voice note
 * on a slow connection needs to show that something is happening. Nothing
 * here touches our API - the file never passes through it.
 */
export function putToStorage(
  target: UploadTarget,
  file: Blob,
  { onProgress, signal }: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", target.url, true);

    for (const [header, value] of Object.entries(target.headers)) {
      request.setRequestHeader(header, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };

    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new ApiError(`The upload failed (${request.status}).`, request.status));

    request.onerror = () => reject(new ApiError("The upload could not reach storage.", 0));
    request.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

/** Request a target, then put the file there. Returns the stored key. */
export async function uploadAttachment(
  ticketId: string,
  file: Blob,
  {
    kind,
    filename,
    onProgress,
    signal,
  }: {
    kind: AttachmentKind;
    filename?: string;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  },
) {
  const target = await requestUploadTarget(ticketId, {
    kind,
    contentType: file.type,
    size: file.size,
    filename,
  });

  await putToStorage(target, file, { onProgress, signal });
  return target.key;
}

/** "2.4 MB" - what a person needs to know about a file's size. */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "0:07" - a voice note's length. */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

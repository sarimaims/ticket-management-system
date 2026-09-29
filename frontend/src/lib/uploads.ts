import { api, ApiError } from "./api";

/** What a chat can carry. Mirrors the rules the API enforces. */
export type AttachmentKind = "image" | "video" | "file" | "voice";

/** The document formats a chat takes: the same list a request carries. */
const DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.md,.zip,.7z,.rar";

export const ATTACHMENT_LIMITS: Record<AttachmentKind, { maxBytes: number; accept: string }> = {
  image: { maxBytes: 25 * 1024 * 1024, accept: "image/*" },
  video: { maxBytes: 100 * 1024 * 1024, accept: "video/*" },
  file: { maxBytes: 25 * 1024 * 1024, accept: DOCUMENT_ACCEPT },
  voice: { maxBytes: 15 * 1024 * 1024, accept: "audio/webm,audio/ogg,audio/mpeg,audio/mp4" },
};

/**
 * Which chat kind a picked file is, from what the browser says it is.
 *
 * The photo-and-video picker hands back either; the document picker only
 * documents. SVG is refused as a photo for the same reason the API refuses it:
 * it is an image format that can carry script.
 */
export function chatKindOf(file: File, picker: "media" | "document"): AttachmentKind | null {
  const type = file.type.toLowerCase();
  if (picker === "media") {
    if (type === "image/svg+xml") return null;
    if (type.startsWith("image/")) return "image";
    if (type.startsWith("video/")) return "video";
    return null;
  }
  return ticketFileFamily(type)?.label === "document" || !type ? "file" : null;
}

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

const MB = 1024 * 1024;

/**
 * What a ticket itself can carry, mirroring the rules the API enforces.
 *
 * Three families with their own ceilings: one number cannot serve a screen
 * recording and a spreadsheet at once. Pictures and video are matched by
 * their prefix - there are dozens of image formats and any list of them is a
 * list that is missing one - while documents are named, because
 * "application/*" is where executables live too.
 */
export const TICKET_FILE_FAMILIES = {
  image: { prefix: "image/", maxBytes: 25 * MB, label: "image" },
  video: { prefix: "video/", maxBytes: 200 * MB, label: "video" },
  document: {
    maxBytes: 25 * MB,
    label: "document",
    types: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.presentation",
      "application/rtf",
      "application/zip",
      "application/x-zip-compressed",
      "application/x-7z-compressed",
      "application/vnd.rar",
      "text/plain",
      "text/csv",
      "text/markdown",
    ] as string[],
  },
} satisfies Record<string, { prefix?: string; types?: string[]; maxBytes: number; label: string }>;

/** Which family a file belongs to, or null when it belongs to none. */
export function ticketFileFamily(contentType: string) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!type) return null;

  for (const family of Object.values(TICKET_FILE_FAMILIES)) {
    if ("prefix" in family && type.startsWith(family.prefix)) return family;
    if ("types" in family && family.types.includes(type)) return family;
  }
  return null;
}

export const TICKET_FILE_LIMITS = {
  maxCount: 5,
  /** The loosest ceiling, for a check that has no file type to go on. */
  maxBytes: Math.max(...Object.values(TICKET_FILE_FAMILIES).map((family) => family.maxBytes)),
  /**
   * What the file picker offers. The wildcards are what let a phone hand over
   * a HEIC photo or a .mov straight from the camera roll; the extensions are
   * for the desktop browsers that ignore wildcards for anything else.
   */
  accept:
    "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.md,.zip,.7z,.rar",
};

/**
 * Uploads one file attached to a request being written.
 *
 * There is no ticket to name yet - the form is still open - so the key is
 * owned by the person uploading and checked against them again when the ticket
 * is written. The bytes go straight to storage; only the key passes through
 * our API.
 */
export async function uploadTicketFile(
  file: File,
  {
    onProgress,
    signal,
  }: { onProgress?: (percent: number) => void; signal?: AbortSignal } = {},
) {
  const target = await api<UploadTarget>("/tickets/attachments/upload-url", {
    method: "POST",
    body: { contentType: file.type, size: file.size, filename: file.name },
    signal,
  });

  await putToStorage(target, file, { onProgress, signal });
  return { key: target.key, filename: file.name };
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

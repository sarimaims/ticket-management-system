/** Where the API lives. Exported so a stream can be opened against it too. */
export const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api";

/** An error the API answered with, carrying the status so callers can branch. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};

/**
 * Every call sends the session cookie, so authorisation is decided by the
 * server. Nothing here trusts a role held in the browser.
 */
export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      (payload as { message?: string } | null)?.message ?? "Something went wrong.",
      response.status,
    );
  }

  return payload as T;
}

/** A GET that the server may answer with "nothing moved" instead of a body. */
export type Revalidated<T> =
  | { changed: true; data: T; etag: string | null }
  | { changed: false; data: null; etag: string | null };

/**
 * Conditional GET. The tag from the last answer goes back up as
 * `If-None-Match`; if the result is still the same the server replies 304
 * with an empty body and the caller leaves its state alone.
 */
export async function apiRevalidate<T>(
  path: string,
  etag: string | null,
  signal?: AbortSignal,
): Promise<Revalidated<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: "include",
      // The tag is ours to manage, so the browser's own cache must stay out of
      // it - otherwise it answers 200 from cache and the 304 never surfaces.
      cache: "no-store",
      headers: etag ? { "If-None-Match": etag } : undefined,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("Cannot reach the server. Is the API running?", 0);
  }

  if (response.status === 304) return { changed: false, data: null, etag };

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      (payload as { message?: string } | null)?.message ?? "Something went wrong.",
      response.status,
    );
  }

  return { changed: true, data: payload as T, etag: response.headers.get("ETag") };
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

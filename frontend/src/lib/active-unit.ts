/**
 * Which unit the person is working in right now.
 *
 * A view preference, not a permission: it narrows the lists to one part of the
 * organisation, and it can only ever be one of the units they already belong
 * to. Switching it grants nothing - what they are allowed to read is still
 * decided by the server, from their department memberships.
 *
 * It lives in the browser rather than on the account, like the notification
 * mute: it is about this person at this desk, and it must survive a reload
 * without a round trip.
 */
const KEY = "flowdesk.active-unit";

const listeners = new Set<() => void>();

/** The stored unit id, or "" for every unit at once. */
export function activeUnit() {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    // A browser with storage blocked simply shows everything.
    return "";
  }
}

export function setActiveUnit(id: string) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    // Nothing to remember it with; the switch still applies for this render.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeActiveUnit(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The server knows nothing of this browser, so it renders unscoped. */
export const activeUnitOnServer = () => "";

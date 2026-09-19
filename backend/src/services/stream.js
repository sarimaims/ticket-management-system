/**
 * Live delivery for notifications, over server-sent events.
 *
 * Polling is what the browser throttles hardest when a tab is in the
 * background - Chrome drops a hidden page's timers to about one a minute -
 * so a poll alone cannot make a sound arrive promptly when the person is
 * working in another window. An open stream is not a timer, so the message
 * arrives the moment it is written.
 */
const clients = new Map();

/** Registers one open response; returns the function that unregisters it. */
export function addClient(userId, res) {
  const key = String(userId);
  const set = clients.get(key) ?? new Set();
  set.add(res);
  clients.set(key, set);

  return () => {
    const live = clients.get(key);
    if (!live) return;
    live.delete(res);
    if (live.size === 0) clients.delete(key);
  };
}

/** Sends one event to every tab that person has open. Never throws. */
export function publish(userId, event, payload = {}) {
  const set = clients.get(String(userId));
  if (!set || set.size === 0) return 0;

  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  let sent = 0;
  for (const res of set) {
    try {
      res.write(frame);
      sent += 1;
    } catch {
      // A dead socket is cleaned up by its own close handler.
    }
  }
  return sent;
}

export function connectionCount() {
  let total = 0;
  for (const set of clients.values()) total += set.size;
  return total;
}

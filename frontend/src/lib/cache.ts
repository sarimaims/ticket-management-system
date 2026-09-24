/**
 * A short memory for lists that barely change.
 *
 * Departments, units and the option lists behind the pickers are fetched again
 * on nearly every page, and each fetch is a full round trip to an API that may
 * be a continent away. They change a few times a month, so the same answer is
 * reused for a minute and shared by everything asking at once - a second
 * caller during the first request waits on that request rather than starting
 * another.
 *
 * Deliberately not a cache library: one map, one TTL, and an explicit way to
 * forget something the moment it is written to.
 */
type Entry<T> = { at: number; value: Promise<T> };

const TTL_MS = 60_000;
const entries = new Map<string, Entry<unknown>>();

/**
 * Runs `load` unless a fresh answer is already in hand.
 *
 * A request carrying its own AbortSignal is never cached: the caller can tear
 * it down mid-flight, and a cancelled promise is not an answer to hand to
 * whoever asks next.
 */
export function cached<T>(key: string, load: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal) return load();

  const found = entries.get(key) as Entry<T> | undefined;
  if (found && Date.now() - found.at < TTL_MS) return found.value;

  const value = load().catch((error) => {
    // A failure must not be remembered as the answer for the next minute.
    entries.delete(key);
    throw error;
  });

  entries.set(key, { at: Date.now(), value });
  return value;
}

/** Forgets everything under a prefix, after something has been written. */
export function forget(prefix: string) {
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

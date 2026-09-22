"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { BASE } from "@/lib/api";
import { useAuth } from "@/components/auth/auth-provider";
import { destination } from "@/components/notifications/notification-shared";
import { useToast } from "@/components/ui/toast";
import {
  chime,
  isMuted,
  mutedOnServer,
  setMuted as storeMuted,
  subscribeMuted,
  wakeChime,
} from "@/lib/chime";
import {
  clearNotifications,
  listNotifications,
  markNotificationsRead,
  type NotificationRecord,
} from "@/lib/notifications";

/**
 * The stream does the announcing; this poll is the safety net for when it is
 * down (a proxy that will not hold a connection, a sleeping laptop), so it can
 * be slower than it was. It runs whether or not the tab is in front: a hidden
 * tab must still beep.
 */
const POLL_MS = 20_000;

type NotificationApi = {
  items: NotificationRecord[];
  unread: number;
  loading: boolean;
  muted: boolean;
  setMuted: (muted: boolean) => void;
  markAllRead: () => Promise<void>;
  /** Reading one: opening what it points at is enough. */
  markOneRead: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  refresh: () => Promise<void>;
};

const NotificationContext = createContext<NotificationApi | null>(null);

/**
 * Polls the feed and announces what is new: a toast in the ticket colour when
 * one arrives, a quieter one when a ticket moves, each with its own chime.
 *
 * Polling rather than a socket, because the API is a plain Express app. The
 * cost is one small request every {@link POLL_MS}, and none at all while the
 * tab is in the background.
 */
export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, mutedOnServer);

  // Ids already announced. The first load fills this without making a sound,
  // so signing in does not replay everything that happened while you were out.
  const announced = useRef<Set<string> | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const data = await listNotifications(signal);
        setItems(data.notifications);
        setUnread(data.unread);

        if (announced.current === null) {
          announced.current = new Set(data.notifications.map((item) => item.id));
          return;
        }

        const fresh = data.notifications
          .filter((item) => !item.read && !announced.current!.has(item.id))
          .reverse();

        for (const item of fresh) {
          announced.current!.add(item.id);
          toast.show({
            tone:
              item.type === "ticket.new"
                ? "ticket"
                : item.type === "ticket.message"
                  ? "message"
                  : "update",
            title: item.title,
            description: item.body,
            href: destination(item),
          });
        }

        if (fresh.length > 0 && !isMuted()) {
          // Loudest first: a ticket arriving outranks a reply to one you know
          // about, and a run of plain messages only ever taps.
          if (fresh.some((item) => item.type === "ticket.new")) chime.newTicket();
          else if (fresh.every((item) => item.type === "ticket.message")) chime.message();
          else chime.update();
        }
      } catch {
        // A failed poll is not worth a message: the next one is 12 seconds away.
      } finally {
        // An aborted request is not an answer. React mounts an effect twice in
        // development, so the first fetch is always cancelled: clearing the flag
        // here would declare "nothing found" while the real request is still out.
        if (!signal?.aborted) setLoading(false);
      }
    },
    [toast],
  );

  // One timer, only while signed in and only while the tab is in front.
  useEffect(() => {
    if (!session) return;

    const controller = new AbortController();
    // Polling an API is the "subscribe to an external system" case the rule
    // allows; it cannot see that the state lands in a later microtask.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(controller.signal);

    const timer = setInterval(() => load(), POLL_MS);

    // Coming back to the tab should not wait for the next tick either.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    /**
     * The live stream. A browser throttles a hidden tab's timers hard, so the
     * poll above cannot be relied on to announce anything promptly while the
     * person is in another window; an open connection is not a timer, and the
     * message lands as soon as the server writes it. EventSource reconnects
     * on its own, so a drop needs no handling here.
     */
    const stream = new EventSource(`${BASE}/notifications/stream`, { withCredentials: true });
    stream.addEventListener("notification", () => load());

    return () => {
      controller.abort();
      clearInterval(timer);
      stream.close();
      document.removeEventListener("visibilitychange", onVisible);

      // Leaving this session behind: forget whose feed it was, so signing in
      // as someone else does not inherit it or replay it as new.
      announced.current = null;
      setItems([]);
      setUnread(0);
    };
  }, [session, load]);

  // Browsers keep audio silent until the page is interacted with, and they
  // suspend it again whenever the tab goes to sleep. So every gesture wakes
  // it, not only the first: one missed resume is a notification nobody hears.
  useEffect(() => {
    const wake = () => wakeChime();
    document.addEventListener("pointerdown", wake);
    document.addEventListener("keydown", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      document.removeEventListener("pointerdown", wake);
      document.removeEventListener("keydown", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  const api = useMemo<NotificationApi>(
    () => ({
      items,
      unread,
      loading,
      muted,
      setMuted: storeMuted,
      markOneRead: async (id) => {
        setItems((current) =>
          current.map((item) => (item.id === id ? { ...item, read: true } : item)),
        );
        setUnread((current) => Math.max(0, current - 1));
        try {
          await markNotificationsRead([id]);
        } catch {
          await load();
        }
      },
      markAllRead: async () => {
        setUnread(0);
        setItems((current) => current.map((item) => ({ ...item, read: true })));
        try {
          await markNotificationsRead();
        } catch {
          await load();
        }
      },
      clearAll: async () => {
        setItems([]);
        setUnread(0);
        try {
          await clearNotifications();
        } catch {
          await load();
        }
      },
      refresh: () => load(),
    }),
    [items, unread, loading, muted, load],
  );

  return <NotificationContext.Provider value={api}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const api = useContext(NotificationContext);
  if (!api) throw new Error("useNotifications must be used inside <NotificationProvider>.");
  return api;
}

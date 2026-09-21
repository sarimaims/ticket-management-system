/**
 * Two short chimes, synthesised rather than loaded: no audio file to ship, no
 * request to make, and nothing to go missing. A new ticket rings a rising
 * three-note figure; an update is a softer two-note fall, so the two are told
 * apart without looking at the screen.
 */
type Note = { hz: number; at: number; seconds: number; gain: number };

/** C6 - E6 - G6: a major chord climbing, which is the "something arrived" one. */
const NEW_TICKET: Note[] = [
  { hz: 1046.5, at: 0, seconds: 0.5, gain: 0.85 },
  { hz: 1318.5, at: 0.1, seconds: 0.5, gain: 0.8 },
  { hz: 1568.0, at: 0.2, seconds: 0.75, gain: 0.75 },
];

/** A5 up to D6, short and light: somebody is talking, not filing. */
const MESSAGE: Note[] = [
  { hz: 880.0, at: 0, seconds: 0.26, gain: 0.45 },
  { hz: 1174.7, at: 0.075, seconds: 0.38, gain: 0.4 },
];

/** G5 down to E5: the same voice, quieter, saying a ticket merely moved. */
const UPDATE: Note[] = [
  { hz: 783.99, at: 0, seconds: 0.4, gain: 0.6 },
  { hz: 659.25, at: 0.11, seconds: 0.6, gain: 0.55 },
];

/** How loud the whole thing is, before a single note's own gain. */
const MASTER = 0.5;

let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

/**
 * Browsers refuse to play until the page has been interacted with, and they
 * suspend the context again when the tab sleeps. So this is called on every
 * gesture, not just the first one.
 */
export function wakeChime() {
  const ctx = audio();
  if (ctx?.state === "suspended") void ctx.resume();
}

/**
 * One struck note. A bell is the fundamental plus quieter harmonics above it,
 * all decaying together - a bare sine sounds like a test tone instead.
 */
function strike(ctx: AudioContext, note: Note, start: number) {
  // Rolling the top off keeps it sweet rather than piercing at this volume.
  const softener = ctx.createBiquadFilter();
  softener.type = "lowpass";
  softener.frequency.value = 5200;

  const shape = ctx.createGain();
  const from = start + note.at;
  const peak = Math.max(0.0002, note.gain * MASTER);

  // A flat envelope clicks; a quick swell and a long tail is what rings.
  shape.gain.setValueAtTime(0.0001, from);
  shape.gain.exponentialRampToValueAtTime(peak, from + 0.012);
  shape.gain.exponentialRampToValueAtTime(0.0001, from + note.seconds);

  softener.connect(shape).connect(ctx.destination);

  // Fundamental, octave, twelfth: each thinner than the one below it.
  for (const [multiple, share] of [
    [1, 1],
    [2, 0.32],
    [3, 0.1],
  ] as const) {
    const oscillator = ctx.createOscillator();
    const voice = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = note.hz * multiple;
    voice.gain.value = share;

    oscillator.connect(voice).connect(softener);
    oscillator.start(from);
    oscillator.stop(from + note.seconds + 0.05);
  }
}

function schedule(ctx: AudioContext, notes: Note[]) {
  const start = ctx.currentTime + 0.01;
  for (const note of notes) strike(ctx, note, start);
}

function play(notes: Note[]) {
  const ctx = audio();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    // resume() settles a tick later, so waiting for it is the difference
    // between a chime and silence. If the browser still refuses, the toast
    // has already said everything the sound would have.
    // Promise.resolve, because older Safari's resume() returns nothing.
    void Promise.resolve(ctx.resume()).then(
      () => schedule(ctx, notes),
      () => {},
    );
    return;
  }

  schedule(ctx, notes);
}

export const chime = {
  newTicket: () => play(NEW_TICKET),
  update: () => play(UPDATE),
  message: () => play(MESSAGE),
};

const MUTE_KEY = "flowdesk.notifications.muted";

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "yes";
  } catch {
    return false;
  }
}

/**
 * The preference lives in the browser, not in React, so components read it
 * through useSyncExternalStore rather than copying it into state on mount.
 */
const listeners = new Set<() => void>();

export function subscribeMuted(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "yes" : "no");
  } catch {
    // A browser with storage blocked simply forgets the preference.
  }
  listeners.forEach((listener) => listener());
}

/** The server knows nothing of this browser, so it renders as unmuted. */
export const mutedOnServer = () => false;

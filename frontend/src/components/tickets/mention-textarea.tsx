"use client";

import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";

import { initials } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** Somebody who can be named with "@", and a line saying who they are here. */
export type MentionPerson = { id: string; name: string; note?: string };

/** A person named in the text, as written. */
export type Mention = { id: string; name: string };

/** How many people the list offers at once. */
const MAX_OPTIONS = 6;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The mentions still written in the text: a name deleted is no longer one. */
export const mentionsIn = (text: string, mentions: Mention[]) =>
  mentions.filter((mention) => text.includes(`@${mention.name}`));

/**
 * The "@word" being typed just before the caret, if there is one: an "@" at
 * the start of the text or after a space, and the letters since.
 */
function queryAt(text: string, caret: number) {
  const match = /(^|\s)@([^\s@]{0,40})$/u.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2].length - 1, text: match[2] };
}

/** A name with the part that matched what was typed picked out. */
function Matched({ name, query }: { name: string; query: string }) {
  const at = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <span className="text-chat-accent-strong">{name.slice(at, at + query.length)}</span>
      {name.slice(at + query.length)}
    </>
  );
}

/** Text and box share these, so the marks behind the text sit exactly under it. */
const TEXT = "w-full px-1.5 py-1 text-[13px] leading-snug whitespace-pre-wrap break-words";

/**
 * The message box, the way WhatsApp's behaves.
 *
 * It grows a line at a time as the text does and, past a handful of lines,
 * stops and scrolls inside instead - so a long message never pushes the
 * thread off the screen. Typing "@" opens a list of the people on the ticket:
 * arrows move through it, Enter or Tab picks, Escape closes, and the name goes
 * in whole. A picked name is marked in the box behind the text, the same way
 * it will be marked in the thread.
 *
 * Enter sends and Shift+Enter breaks the line, unless the list is open, when
 * Enter picks.
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  mentions,
  onMentionsChange,
  onEnter,
  ref,
  maxRows = 6,
  maxLength,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Who can be named. The writer leaves themselves out. */
  people: MentionPerson[];
  mentions: Mention[];
  onMentionsChange: (mentions: Mention[]) => void;
  /** Enter, when the list is not open: what sends the message. */
  onEnter?: () => void;
  /** The box itself, for whoever needs to focus it. */
  ref?: Ref<HTMLTextAreaElement | null>;
  /** How far it grows before it scrolls instead. */
  maxRows?: number;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  // The parent is handed the same element, without this component writing to
  // a ref it was given.
  useImperativeHandle<HTMLTextAreaElement | null, HTMLTextAreaElement | null>(ref, () => box.current, []);
  const backdrop = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<{ start: number; text: string } | null>(null);
  const [active, setActive] = useState(0);

  // Grows with the text until maxRows, then holds its height and scrolls.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const style = getComputedStyle(element);
    const line = Number.parseFloat(style.lineHeight) || 18;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const ceiling = line * maxRows + padding;

    element.style.height = "auto";
    const height = Math.min(element.scrollHeight, ceiling);
    element.style.height = `${height}px`;
    element.style.overflowY = element.scrollHeight > ceiling ? "auto" : "hidden";
    if (backdrop.current) backdrop.current.scrollTop = element.scrollTop;
  }, [value, maxRows]);

  const options = useMemo(() => {
    if (!query) return [];
    const typed = query.text.toLowerCase();
    return people
      .filter(
        (person) =>
          !typed ||
          person.name.toLowerCase().includes(typed) ||
          person.name
            .toLowerCase()
            .split(/\s+/)
            .some((word) => word.startsWith(typed)),
      )
      .sort(
        (left, right) =>
          Number(right.name.toLowerCase().startsWith(typed)) - Number(left.name.toLowerCase().startsWith(typed)),
      )
      .slice(0, MAX_OPTIONS);
  }, [query, people]);

  const open = query !== null && options.length > 0;
  const current = Math.min(active, Math.max(options.length - 1, 0));

  // The marks behind the text: every name still written, longest first so a
  // short name never eats the start of a longer one.
  const pieces = useMemo(() => {
    const names = mentionsIn(value, mentions)
      .map((mention) => mention.name)
      .sort((left, right) => right.length - left.length);
    if (names.length === 0) return [value];
    return value.split(new RegExp(`(@(?:${names.map(escapeRegExp).join("|")}))`, "g"));
  }, [value, mentions]);

  /** Reads where the caret is and whether an "@" is being typed there. */
  const track = (element: HTMLTextAreaElement) => {
    const next = queryAt(element.value, element.selectionStart ?? 0);
    if (next?.start === query?.start && next?.text === query?.text) return;
    setQuery(next);
    setActive(0);
  };

  const choose = (person: MentionPerson) => {
    const element = box.current;
    if (!element || !query) return;
    const caret = element.selectionStart ?? value.length;
    const written = `@${person.name} `;
    const next = value.slice(0, query.start) + written + value.slice(caret);
    if (maxLength && next.length > maxLength) return;

    onChange(next);
    onMentionsChange([
      ...mentionsIn(next, mentions).filter((mention) => mention.id !== person.id),
      { id: person.id, name: person.name },
    ]);
    setQuery(null);

    const at = query.start + written.length;
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(at, at);
    });
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      {/* The same text, invisible, with the picked names marked: it sits under
          the box and scrolls with it, so each mark lands under its name. */}
      <div
        ref={backdrop}
        aria-hidden="true"
        className={cn(TEXT, "pointer-events-none absolute inset-0 overflow-hidden text-transparent")}
      >
        {pieces.map((piece, index) =>
          index % 2 === 1 ? (
            <mark key={index} className="rounded-[3px] bg-chat-accent/20 text-transparent">
              {piece}
            </mark>
          ) : (
            <span key={index}>{piece}</span>
          ),
        )}
        {"​"}
      </div>

      <textarea
        ref={box}
        value={value}
        rows={1}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={open ? "mention-options" : undefined}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next);
          const kept = mentionsIn(next, mentions);
          if (kept.length !== mentions.length) onMentionsChange(kept);
          track(event.target);
        }}
        onSelect={(event) => track(event.currentTarget)}
        onBlur={() => setQuery(null)}
        onScroll={(event) => {
          if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={(event) => {
          if (open) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % options.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + options.length) % options.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(options[current]);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setQuery(null);
              return;
            }
          }
          // Enter sends, Shift+Enter breaks the line: what everyone already
          // expects of a message box. Not while an IME is still composing.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onEnter?.();
          }
        }}
        className={cn(
          TEXT,
          "relative block min-h-7 resize-none border-0 bg-transparent text-ink-900 caret-ink-900",
          "placeholder:truncate placeholder:text-ink-400 focus:ring-0 focus:outline-none",
          // Scrolls without a bar, so the text wraps at the same width as the
          // marks behind it.
          "scrollbar-none [&::-webkit-scrollbar]:hidden",
        )}
      />

      {open && (
        <ul
          id="mention-options"
          role="listbox"
          aria-label="People to mention"
          className="absolute bottom-full left-0 z-50 mb-3 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl shadow-ink-900/15"
        >
          {options.map((person, index) => (
            <li key={person.id} role="option" aria-selected={index === current}>
              <button
                type="button"
                // Picked without the box losing focus first.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(person)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                  index === current ? "bg-ink-50" : "hover:bg-ink-50",
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chat-accent/15 text-[11px] font-semibold text-chat-accent-strong">
                  {initials(person.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">
                    <Matched name={person.name} query={query?.text ?? ""} />
                  </span>
                  {person.note && <span className="block truncate text-[11px] text-ink-400">{person.note}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

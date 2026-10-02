"use client";

import { UserLink } from "@/components/users/user-profile";
import { cn } from "@/lib/utils";

/**
 * Text with its web addresses made clickable.
 *
 * Only http and https are turned into links - never "javascript:" or "data:",
 * which is the whole reason this is not done with a general-purpose parser.
 * Trailing punctuation stays with the sentence it ended: "see
 * https://example.com." links to example.com, not "example.com.".
 */
const LINK = /\bhttps?:\/\/[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]]+$/;

export function Linkified({ text, className }: { text: string; className?: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;

  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(TRAILING, "");

    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={`${start}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        // A link inside a bubble must not also open the bubble's own menu.
        onClick={(event) => event.stopPropagation()}
        className="break-all underline decoration-current/40 underline-offset-2 hover:decoration-current"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }

  if (last < text.length) parts.push(text.slice(last));

  return <span className={className}>{parts}</span>;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A message's text: its links clickable and the people it names marked.
 *
 * Only the names the server confirmed are marked - never something that merely
 * looks like "@someone" - and a name opens that person's card. Your own name
 * is set on a soft wash as well, the way a chat app makes "you" stand out.
 */
export function MessageText({
  text,
  mentions,
  meId,
  className,
}: {
  text: string;
  mentions?: { id: string; name: string }[];
  meId?: string;
  className?: string;
}) {
  // Longest first, so "@Ali" never eats the start of "@Ali Raza".
  const named = (mentions ?? [])
    .filter((mention) => text.includes(`@${mention.name}`))
    .sort((left, right) => right.name.length - left.name.length);
  if (named.length === 0) return <Linkified text={text} className={className} />;

  const byWord = new Map(named.map((mention) => [`@${mention.name}`, mention]));
  const parts = text.split(
    new RegExp(`(${named.map((mention) => escapeRegExp(`@${mention.name}`)).join("|")})`, "g"),
  );

  return (
    <span className={className}>
      {parts.map((part, index) => {
        const mention = index % 2 === 1 ? byWord.get(part) : undefined;
        if (!mention) return part ? <Linkified key={index} text={part} /> : null;
        return (
          <UserLink
            key={index}
            id={mention.id}
            name={part}
            className={cn(
              "inline rounded-[3px] font-semibold text-chat-accent-strong",
              mention.id === meId && "bg-chat-accent/15 px-0.5",
            )}
          />
        );
      })}
    </span>
  );
}

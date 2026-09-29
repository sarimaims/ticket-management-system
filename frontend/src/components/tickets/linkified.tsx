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

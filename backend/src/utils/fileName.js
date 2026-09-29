/**
 * The name a person gave their file, made safe to keep.
 *
 * The file itself is stored under a random key - never under this name, so no
 * upload can overwrite another or be guessed at - but the name it arrived with
 * is kept alongside, because it is how people remember a file. Somebody looking
 * for "the salary list" types "salary", not a hash, and the only place that
 * word survives is here.
 *
 * So it is cleaned rather than replaced: control characters and path
 * separators go (a name is never a path), runs of whitespace collapse, and the
 * length is capped. Everything else - case, hyphens, the extension - is left
 * exactly as it was typed, since those are what a search will be matched on.
 */
const MAX_LENGTH = 200;

export function cleanFilename(raw, fallback = '') {
  if (typeof raw !== 'string') return fallback;

  // Some browsers hand over "C:\fakepath\name.pdf"; the name is the last part.
  const base = raw.split(/[\\/]/).pop() ?? '';

  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return fallback;
  if (cleaned.length <= MAX_LENGTH) return cleaned;

  // Over the cap, keep the extension: "report.pdf" cut to "repo" is a worse
  // name than "rep….pdf", and the extension is what a search by type needs.
  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, MAX_LENGTH - extension.length) + extension;
}

/**
 * The words in a filename, for matching a search against it.
 *
 * "aims-digital-salary-list.xlsx" and a search for "digital salary" share no
 * substring, but they do share words. Splitting on the separators people
 * actually use lets each word of the search be looked for on its own.
 */
export function filenameWords(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .split(/[\s\-_.,()[\]{}+]+/)
    .filter(Boolean);
}

/** One word of a search, safe to put inside a regular expression. */
export function escapeForRegex(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

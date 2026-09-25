/**
 * Phone numbers, as the API stores them.
 *
 * The API keeps digits with an optional leading "+", so the same number typed
 * "+971 50 123 4567" or "+971501234567" is one value there. The rules are
 * repeated here so a form can say what is wrong before the request is made,
 * and must stay in step with backend/src/utils/phoneNumber.js.
 */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/** Digits, and the punctuation people put between them. */
const ALLOWED = /^\+?[\d\s().-]*$/;

/** What the user is allowed to type: anything else is simply not accepted. */
export const acceptPhone = (typed: string) => {
  const trimmed = typed.replace(/^\s+/, "");
  // A "+" only means anything at the front, so only one is kept, there.
  const plus = trimmed.startsWith("+");
  const rest = trimmed.replace(/\+/g, "").replace(/[^\d\s().-]/g, "");
  return (plus ? "+" : "") + rest;
};

/** The value the API is sent: digits, and the "+" if it was given. */
export function toStoredPhone(typed: string) {
  const raw = typed.trim();
  const digits = raw.replace(/\D/g, "");
  return raw.startsWith("+") ? `+${digits}` : digits;
}

/** Whether this is a number the API will accept. */
export function isPhone(typed: string) {
  const raw = typed.trim();
  if (!ALLOWED.test(raw)) return false;
  const digits = raw.replace(/\D/g, "").length;
  return digits >= MIN_DIGITS && digits <= MAX_DIGITS;
}

/** The one line to show when it is not. */
export const PHONE_HELP = `Enter a valid phone number (${MIN_DIGITS}-${MAX_DIGITS} digits).`;

/**
 * A stored number, spaced out for reading: "+971501000101" becomes
 * "+971 501 000 101". Anything that is not a number it recognises is printed
 * exactly as it was stored rather than mangled into groups.
 */
export function formatPhone(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) return raw;

  const plus = raw.startsWith("+");
  // With a country code the first three digits are it; without one they are
  // the start of the number and group like the rest.
  const head = plus ? digits.slice(0, 3) : "";
  const groups = (plus ? digits.slice(3) : digits).match(/\d{1,3}/g) ?? [];

  // A lone digit at the end reads as a typo, so it joins the group before it.
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    groups[groups.length - 2] += groups.pop();
  }

  return [plus ? `+${head}` : "", ...groups].filter(Boolean).join(" ");
}

import ApiError from './ApiError.js';

/** What may be typed: digits, and the punctuation people put between them. */
const ALLOWED = /^\+?[\d\s().-]+$/;

/** E.164 allows fifteen digits; nothing shorter than seven is a real line. */
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

/**
 * The shape a stored number always has: digits, and a "+" when it was given
 * with a country code. Used by the model and by every form that shows one.
 */
export const PHONE_PATTERN = /^\+?\d{7,15}$/;

/**
 * Normalises a phone number, or says why it is not one.
 *
 * Spaces, brackets and dashes are how people write a number and not part of
 * it, so they are dropped on the way in - two accounts typed as
 * "+971 50 123 4567" and "+971501234567" are then the same string in the
 * database, and searching for one finds the other.
 *
 * Checked here as well as in the app: a request made any other way must not be
 * able to store something the app itself would have refused.
 */
export function phoneNumber(value, label = 'Phone number') {
  const raw = String(value ?? '').trim();

  if (!raw) throw ApiError.badRequest(`${label} is required.`);
  if (!ALLOWED.test(raw)) {
    throw ApiError.badRequest(`${label} can only contain digits and + ( ) - spaces.`);
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    throw ApiError.badRequest(`${label} must be ${MIN_DIGITS} to ${MAX_DIGITS} digits.`);
  }

  return raw.startsWith('+') ? `+${digits}` : digits;
}

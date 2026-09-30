import ApiError from './ApiError.js';

/** The longest a designation may be; the model enforces the same. */
const MAX_LENGTH = 80;

/**
 * A job title, or the reason it is not one.
 *
 * One rule for every way an account is made - the admin directory, a head
 * adding to their team, a department page - so they cannot drift into
 * disagreeing about whether "" is a designation.
 */
export function designation(value) {
  const cleaned = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  if (!cleaned) throw ApiError.badRequest('Designation is required.');
  if (cleaned.length < 2) throw ApiError.badRequest('That designation is too short.');
  if (cleaned.length > MAX_LENGTH) {
    throw ApiError.badRequest(`Keep the designation under ${MAX_LENGTH} characters.`);
  }

  return cleaned;
}

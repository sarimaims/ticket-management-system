import env from '../config/env.js';
import ApiError from './ApiError.js';

/**
 * Normalises an address and refuses one off the workspace's own domain.
 *
 * Checked here as well as in the app, which only offers the part before the
 * "@": a request made any other way must not be able to create an account the
 * app itself could never have made.
 */
export function workEmail(email) {
  const normalised = String(email ?? '').trim().toLowerCase();
  if (!normalised.endsWith(`@${env.emailDomain}`) || normalised === `@${env.emailDomain}`) {
    throw ApiError.badRequest(`Email must be a @${env.emailDomain} address.`);
  }
  return normalised;
}

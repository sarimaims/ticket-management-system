import ApiError from '../utils/ApiError.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import env from '../config/env.js';
import { verifyToken } from '../utils/token.js';

/**
 * The account behind a session, briefly remembered.
 *
 * Every request re-read the user, and with the database a third of a second
 * away that was a third of a second added to every call the app makes - often
 * more than the work the request came to do. The window is deliberately short:
 * a suspension or a change of department takes effect within a few seconds
 * rather than instantly, which is the right trade for a workspace tool.
 */
const USER_TTL_MS = 5000;
const recent = new Map();

function cached(id) {
  const hit = recent.get(id);
  if (!hit) return null;
  if (Date.now() - hit.at > USER_TTL_MS) {
    recent.delete(id);
    return null;
  }
  return hit.user;
}

function remember(id, user) {
  recent.set(id, { user, at: Date.now() });
  // Nothing here is worth a leak: the map is small, and the oldest entries are
  // dropped once it grows past a workspace's worth of people.
  if (recent.size > 500) {
    for (const [key, value] of recent) {
      if (Date.now() - value.at > USER_TTL_MS) recent.delete(key);
    }
  }
}

/** Drops a cached account, so a change to it is felt on the next request. */
export function forgetUser(id) {
  recent.delete(String(id));
}

/** Rejects the request unless it carries a valid session cookie. */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[env.cookieName];
    if (!token) throw ApiError.unauthorized();

    const payload = verifyToken(token);
    const id = String(payload.sub);
    const user = cached(id) ?? (await User.findById(id));

    if (!user) throw ApiError.unauthorized('This account no longer exists.');
    remember(id, user);
    if (user.status === 'suspended') throw ApiError.forbidden('This account is suspended.');

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(ApiError.unauthorized('Your session has expired. Sign in again.'));
    }
    return next(error);
  }
}

/** Authorisation is decided here on the server, never from anything the client sends. */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'superadmin') {
    return next(ApiError.forbidden('Only a super admin can do this.'));
  }
  return next();
}

/** Super admin or admin: everything that manages the workspace. */
export function requireAdmin(req, res, next) {
  if (!MANAGER_ROLES.includes(req.user?.role)) {
    return next(ApiError.forbidden('You do not have permission to do this.'));
  }
  return next();
}

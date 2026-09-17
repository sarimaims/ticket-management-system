import ApiError from '../utils/ApiError.js';
import User, { MANAGER_ROLES } from '../models/User.js';
import env from '../config/env.js';
import { verifyToken } from '../utils/token.js';

/** Rejects the request unless it carries a valid session cookie. */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[env.cookieName];
    if (!token) throw ApiError.unauthorized();

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);

    if (!user) throw ApiError.unauthorized('This account no longer exists.');
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

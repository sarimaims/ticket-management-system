import jwt from 'jsonwebtoken';

import env from '../config/env.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

/**
 * The session cookie is httpOnly, so no script on the page can read it, and
 * sameSite=lax keeps it off cross-site requests. Over HTTPS it is also secure.
 */
export function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, { path: '/' });
}

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
 * The session cookie is httpOnly, so no script on the page can read it.
 *
 * sameSite=lax is the default and keeps it off cross-site requests, which is
 * most of the CSRF defence here. When the API is reached from another site -
 * a dev tunnel while the page is on localhost - the browser will not send a
 * lax cookie at all, so CROSS_SITE_COOKIE=yes switches it to None, which
 * requires Secure and therefore HTTPS.
 */
function cookieOptions() {
  const crossSite = env.crossSiteCookie;
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite || env.isProduction,
    path: '/',
  };
}

export function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, {
    ...cookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// Clearing has to match how it was set, or the browser keeps the old one.
export function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, cookieOptions());
}

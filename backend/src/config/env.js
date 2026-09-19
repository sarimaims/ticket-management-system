import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT) || 5000,
  // One or more origins, comma separated. A dev tunnel adds a second one
  // without taking localhost away.
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /**
   * Serving the API from a different site than the page - a dev tunnel, say -
   * means the session cookie only travels as SameSite=None; Secure. That is
   * opt-in, because it also drops the SameSite protection against CSRF that
   * the default relies on.
   */
  crossSiteCookie: ['1', 'true', 'yes'].includes(
    (process.env.CROSS_SITE_COOKIES ?? process.env.CROSS_SITE_COOKIE ?? '').toLowerCase(),
  ),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/flowdesk_tickets',
  // A throwaway secret keeps local dev running; production refuses to start without a real one.
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: 'flowdesk_token',
};

export default env;

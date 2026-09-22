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
  /**
   * Where chat attachments are stored. Leave the bucket empty and the feature
   * reports itself as unavailable rather than half working: the buttons are
   * disabled in the app and the endpoint answers 503.
   *
   * Credentials are optional - on EC2, ECS or Lambda the SDK uses the instance
   * role, which is safer than keys in a file.
   */
  s3: {
    bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET || '',
    region: process.env.S3_REGION || process.env.AWS_REGION || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    /** Set for MinIO or another S3-compatible service. */
    endpoint: process.env.S3_ENDPOINT || '',
    /** Only when the bucket is genuinely public, e.g. behind a CDN. */
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
    /** Folder inside the bucket, so one bucket can hold several apps. */
    prefix: (process.env.S3_PREFIX || 'upload/').replace(/^\/+|\/*$/g, '') + '/',
  },
};

export default env;

import crypto from 'node:crypto';
import path from 'node:path';

import { HeadObjectCommand, PutObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import env from '../config/env.js';

/**
 * Where a chat's photos and voice notes live.
 *
 * Nothing is uploaded through this API: the browser is handed a presigned URL
 * and PUTs the bytes straight to S3. A 20 MB voice note therefore never
 * occupies an Express worker, and the object is in the bucket before the
 * message that refers to it exists.
 *
 * Everything here answers honestly when the bucket is not configured yet, so
 * the rest of the app can be built and tested without credentials.
 */

/** What a chat may hold, and how big each kind is allowed to be. */
export const ATTACHMENT_KINDS = {
  image: {
    folder: 'images',
    types: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'],
    maxBytes: 10 * 1024 * 1024,
    label: 'Photo',
  },
  voice: {
    folder: 'voices',
    types: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/aac'],
    maxBytes: 15 * 1024 * 1024,
    label: 'Voice note',
  },
};

/** How long a browser has to finish a PUT, and to load what it reads back. */
const UPLOAD_URL_TTL = 5 * 60;
const DOWNLOAD_URL_TTL = 60 * 60;

let client = null;

/** Thrown when the bucket is reachable in principle but unusable right now. */
export class StorageUnavailable extends Error {}

const CREDENTIAL_CODES = [
  'CredentialsProviderError',
  'CredentialsError',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AccessDenied',
  'ExpiredToken',
];

function isCredentialProblem(error) {
  const name = error?.name ?? '';
  const code = error?.Code ?? error?.code ?? '';
  return CREDENTIAL_CODES.includes(name) || CREDENTIAL_CODES.includes(code);
}

function credentialAdvice(error) {
  const name = error?.name ?? error?.Code ?? 'the credentials';
  return `S3 rejected the request (${name}). Check the access key, its permissions on the bucket, and that the region matches.`;
}

export function isConfigured() {
  return Boolean(env.s3.bucket && env.s3.region);
}

function s3() {
  if (!isConfigured()) throw new Error('S3 is not configured.');
  if (client) return client;

  client = new S3Client({
    region: env.s3.region,
    // Credentials are optional on purpose: on EC2, ECS or Lambda the SDK picks
    // up the instance role, which is better than putting keys in a file.
    ...(env.s3.accessKeyId && env.s3.secretAccessKey
      ? {
          credentials: {
            accessKeyId: env.s3.accessKeyId,
            secretAccessKey: env.s3.secretAccessKey,
          },
        }
      : {}),
    // Set for MinIO or any other S3-compatible endpoint.
    ...(env.s3.endpoint ? { endpoint: env.s3.endpoint, forcePathStyle: true } : {}),
  });

  return client;
}

/** Only the extension is kept from the caller's filename; the rest is ours. */
function safeExtension(filename, contentType) {
  const fromName = path.extname(filename ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (fromName && fromName.length <= 6) return fromName;

  const fromType = `.${(contentType ?? '').split('/')[1]?.split(';')[0] ?? 'bin'}`;
  return fromType.replace(/[^a-z0-9.]/g, '') || '.bin';
}

/**
 * The object key for one attachment:
 *
 *   upload/chat/images/<ticketId>-<date>-<random>.png
 *   upload/chat/voices/<ticketId>-<date>-<random>.webm
 *
 * Everything a chat holds sits in one folder per kind, which is what makes the
 * bucket browsable. The ticket id leads the filename rather than making a
 * folder of its own, so a key can still be tied to its thread - and checked
 * against it before a message is written.
 *
 * The key is built here and never taken from the client: a caller that could
 * choose its own could write over someone else's object, or read one by
 * naming it.
 */
export function buildKey({ ticketId, kind, filename, contentType }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const random = crypto.randomBytes(8).toString('hex');
  const folder = ATTACHMENT_KINDS[kind].folder;
  return `${env.s3.prefix}chat/${folder}/${ticketId}-${stamp}-${random}${safeExtension(filename, contentType)}`;
}

/** The start every key for this ticket and kind must have. */
export function keyPrefixFor({ ticketId, kind }) {
  return `${env.s3.prefix}chat/${ATTACHMENT_KINDS[kind].folder}/${ticketId}-`;
}

/** Checks a proposed upload against what this kind of attachment allows. */
export function validateUpload({ kind, contentType, size }) {
  const rules = ATTACHMENT_KINDS[kind];
  if (!rules) return `Attachment kind must be one of: ${Object.keys(ATTACHMENT_KINDS).join(', ')}.`;

  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!rules.types.includes(type)) {
    return `A ${rules.label.toLowerCase()} must be one of: ${rules.types.join(', ')}.`;
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'The file size is missing.';
  if (bytes > rules.maxBytes) {
    return `A ${rules.label.toLowerCase()} cannot be larger than ${Math.round(rules.maxBytes / (1024 * 1024))} MB.`;
  }

  return null;
}

/**
 * A URL the browser may PUT one object to, and nothing else.
 *
 * Signing needs credentials, which the SDK finds in the environment, a shared
 * profile or the instance role. When it finds none the failure is a
 * configuration problem, not a bug in the request, so it is reported as one.
 */
export async function createUploadUrl({ key, contentType, size }) {
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: size,
    }),
    { expiresIn: UPLOAD_URL_TTL },
  ).catch((error) => {
    if (isCredentialProblem(error)) throw new StorageUnavailable(credentialAdvice(error));
    throw error;
  });

  return {
    url,
    // The browser must send exactly these, or the signature will not match.
    headers: { 'Content-Type': contentType },
    expiresIn: UPLOAD_URL_TTL,
  };
}

/**
 * A URL that reads one object back.
 *
 * Signed by default, so the bucket can stay private - which is what you want
 * for a photo attached to an internal ticket. Set S3_PUBLIC_BASE_URL when the
 * bucket is behind a CDN and genuinely public.
 */
export async function createDownloadUrl(key) {
  if (env.s3.publicBaseUrl) {
    return `${env.s3.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }

  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }), {
    expiresIn: DOWNLOAD_URL_TTL,
  });
}

/**
 * What S3 actually holds at that key.
 *
 * Called before a message is written, so a thread cannot end up pointing at an
 * upload that never finished - and so the recorded size and type are the
 * object's own, not the ones the client claimed.
 */
export async function describeObject(key) {
  const head = await s3()
    .send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }))
    .catch((error) => {
      if (isCredentialProblem(error)) throw new StorageUnavailable(credentialAdvice(error));
      throw error;
    });

  return { size: head.ContentLength, contentType: head.ContentType };
}

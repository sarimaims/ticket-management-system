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



const MB = 1024 * 1024;

/**
 * What a ticket itself may carry, as opposed to what its chat may.
 *
 * A different folder and a different rule set: a chat holds photos and voice
 * notes, a request holds whatever the request needs - a photo of the broken
 * thing, a scan of the invoice, a screen recording of the bug.
 *
 * Three families, each with its own ceiling, because one number cannot serve
 * all three: a cap loose enough for a screen recording would let somebody put
 * a 200 MB Word document in the bucket, and one tight enough for a document
 * makes video useless. Pictures and video are matched by their prefix - there
 * are dozens of image formats and a list of them is a list that is always
 * missing one - while documents are named, since "application/*" is where
 * executables live too.
 */
export const TICKET_FILE_FAMILIES = {
  image: { prefix: 'image/', maxBytes: 25 * MB, label: 'image' },
  video: { prefix: 'video/', maxBytes: 200 * MB, label: 'video' },
  document: {
    maxBytes: 25 * MB,
    label: 'document',
    types: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/rtf',
      'application/zip',
      'application/x-zip-compressed',
      'application/x-7z-compressed',
      'application/vnd.rar',
      'text/plain',
      'text/csv',
      'text/markdown',
    ],
  },
};

export const TICKET_FILE = {
  folder: 'files',
  label: 'File',
  /** The loosest of the three, for anything that only needs one number. */
  maxBytes: Math.max(...Object.values(TICKET_FILE_FAMILIES).map((family) => family.maxBytes)),
  /** No more than this on one request; the form stops before the API has to. */
  maxCount: 5,
};

/**
 * What a chat may hold, and how big each kind is allowed to be.
 *
 * Photos and video match by their prefix - a phone's camera roll is HEIC,
 * AVIF and MOV as often as JPG and MP4, and a list of formats is a list that
 * is always missing one. SVG is the exception: it is an image format that is
 * also a script host, and a chat is not the place to find out.
 *
 * A document is the same list a request carries, so a PDF that can be raised
 * with can also be sent in the conversation about it.
 */
export const ATTACHMENT_KINDS = {
  image: {
    folder: 'images',
    prefix: 'image/',
    exclude: ['image/svg+xml'],
    maxBytes: 25 * MB,
    label: 'Photo',
    refusal: 'That is not an image this chat can take.',
  },
  video: {
    folder: 'videos',
    prefix: 'video/',
    maxBytes: 100 * MB,
    label: 'Video',
    refusal: 'That is not a video this chat can take.',
  },
  file: {
    folder: 'documents',
    types: TICKET_FILE_FAMILIES.document.types,
    maxBytes: 25 * MB,
    label: 'Document',
    refusal: 'A document must be a PDF, Word, Excel, PowerPoint, text or zip file.',
  },
  voice: {
    folder: 'voices',
    types: ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/aac'],
    maxBytes: 15 * MB,
    label: 'Voice note',
    refusal: 'A voice note must be a recording in a format this chat can play.',
  },
};

/** Whether one kind of chat attachment will take a given content type. */
function kindAccepts(rules, type) {
  if (rules.exclude?.includes(type)) return false;
  if (rules.prefix) return type.startsWith(rules.prefix);
  return rules.types.includes(type);
}

/** Which family a content type belongs to, or null when it belongs to none. */
export function ticketFileFamily(contentType) {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!type) return null;

  for (const family of Object.values(TICKET_FILE_FAMILIES)) {
    if (family.prefix && type.startsWith(family.prefix)) return family;
    if (family.types?.includes(type)) return family;
  }
  return null;
}

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

/**
 * The object key for one file attached to a ticket:
 *
 *   upload/ticket/files/<userId>-<date>-<random>.pdf
 *
 * Keyed by the person uploading rather than by the ticket, because the file is
 * chosen before the ticket exists - the form uploads while it is being filled
 * in, and the ticket is written at the end. The owner leads the name so the
 * key can be checked against whoever is claiming it.
 */
export function buildTicketKey({ ownerId, filename, contentType }) {
  const stamp = new Date().toISOString().slice(0, 10);
  const random = crypto.randomBytes(8).toString('hex');
  return `${env.s3.prefix}ticket/${TICKET_FILE.folder}/${ownerId}-${stamp}-${random}${safeExtension(filename, contentType)}`;
}

/** The start every key uploaded by this person must have. */
export function ticketKeyPrefixFor(ownerId) {
  return `${env.s3.prefix}ticket/${TICKET_FILE.folder}/${ownerId}-`;
}

/** Checks a proposed ticket attachment against what a request may carry. */
export function validateTicketUpload({ contentType, size }) {
  const family = ticketFileFamily(contentType);
  if (!family) {
    return 'Attachments must be an image, a video, or a document such as a PDF, Word, Excel or text file.';
  }

  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'The file size is missing.';
  if (bytes > family.maxBytes) {
    // Named by family, because "10 MB" on a video is a different answer from
    // "10 MB" on a spreadsheet and the reader needs to know which they hit.
    return `A ${family.label} cannot be larger than ${Math.round(family.maxBytes / MB)} MB.`;
  }

  return null;
}

/** Checks a proposed upload against what this kind of attachment allows. */
export function validateUpload({ kind, contentType, size }) {
  const rules = ATTACHMENT_KINDS[kind];
  if (!rules) return `Attachment kind must be one of: ${Object.keys(ATTACHMENT_KINDS).join(', ')}.`;

  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!kindAccepts(rules, type)) return rules.refusal;

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
export async function createDownloadUrl(key, { saveAs } = {}) {
  if (env.s3.publicBaseUrl) {
    return `${env.s3.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }

  // `saveAs` makes S3 answer with Content-Disposition: attachment, which is
  // what turns a link into a save rather than a photo opening in a tab. The
  // `download` attribute on an anchor cannot do it: the file comes from
  // another origin.
  const disposition = saveAs
    ? `attachment; filename="${String(saveAs).replace(/[^\w.\-() ]/g, '_')}"`
    : undefined;

  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: env.s3.bucket,
      Key: key,
      ...(disposition ? { ResponseContentDisposition: disposition } : {}),
    }),
    { expiresIn: DOWNLOAD_URL_TTL },
  );
}

/**
 * What S3 actually holds at that key.
 *
 * Called before a message is written, so a thread cannot end up pointing at an
 * upload that never finished - and so the recorded size and type are the
 * object's own, not the ones the client claimed.
 */
/**
 * The object's bytes, read through this API rather than handed out as a link.
 *
 * Only for building something out of several objects at once - a zip of a
 * request's files. A single file still goes out as a redirect, because piping
 * it through here would put every download on an Express worker for no gain.
 */
export async function readObject(key) {
  const object = await s3()
    .send(new GetObjectCommand({ Bucket: env.s3.bucket, Key: key }))
    .catch((error) => {
      if (isCredentialProblem(error)) throw new StorageUnavailable(credentialAdvice(error));
      throw error;
    });

  return Buffer.from(await object.Body.transformToByteArray());
}

export async function describeObject(key) {
  const head = await s3()
    .send(new HeadObjectCommand({ Bucket: env.s3.bucket, Key: key }))
    .catch((error) => {
      if (isCredentialProblem(error)) throw new StorageUnavailable(credentialAdvice(error));
      throw error;
    });

  return { size: head.ContentLength, contentType: head.ContentType };
}

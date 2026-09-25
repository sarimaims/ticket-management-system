/**
 * The domain every account's address is on. The app only asks for the part
 * before the "@"; the API refuses anything else, so the two must agree - set
 * NEXT_PUBLIC_EMAIL_DOMAIN here and EMAIL_DOMAIN on the API together.
 */
export const EMAIL_DOMAIN = (process.env.NEXT_PUBLIC_EMAIL_DOMAIN ?? "flowdesk.ae")
  .replace(/^@/, "")
  .toLowerCase();

/** The part before the "@". An address on another domain keeps only its name. */
export const localPart = (email: string) => email.split("@")[0] ?? "";

/** The full address for a name typed into a work-email box, or "" for none. */
export const toWorkEmail = (local: string) => {
  const name = localPart(local.trim());
  return name ? `${name}@${EMAIL_DOMAIN}` : "";
};

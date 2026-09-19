import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 2025-09-20 -> "20 Sep 2025" */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${String(d).padStart(2, "0")} ${months[m - 1]} ${y}`;
}

/** 2026-09-18T14:05:00Z -> "02:05 PM" in the reader's own timezone. */
export function formatTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  // Locales render "pm"/"PM" differently; settle on one so the app is consistent.
  return date
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })
    .toUpperCase();
}

/** Full ISO timestamp -> "18 Sep 2026" for the date part, in local time. */
export function formatDateOf(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${String(date.getDate()).padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

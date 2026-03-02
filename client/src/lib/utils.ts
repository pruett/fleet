import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Truncate text with ellipsis. Returns `fallback` when text is nullish/empty. */
export function truncate(
  text: string | null | undefined,
  maxLength: number,
  fallback = "",
): string {
  if (!text) return fallback;
  return text.length > maxLength ? text.slice(0, maxLength) + "\u2026" : text;
}

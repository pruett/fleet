/**
 * Convert a title to a URL-safe slug.
 * Lowercase, replace non-alphanumeric runs with a single dash, trim dashes.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

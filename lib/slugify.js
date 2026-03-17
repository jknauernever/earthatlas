/**
 * Generate a URL-safe slug from a title string.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')    // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')        // non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')            // trim leading/trailing dashes
    .slice(0, 200)                       // reasonable max length
}

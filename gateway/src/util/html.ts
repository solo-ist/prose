/**
 * util/html.ts — minimal HTML escaping for server-generated pages.
 * Escapes the five characters that are meaningful in HTML/XML attribute and
 * text contexts: &, <, >, ", '. Must be called on any dynamic value before
 * embedding it in an HTML string (href, attribute value, or text node).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

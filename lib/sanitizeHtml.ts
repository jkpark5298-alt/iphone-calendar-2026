/**
 * Lightweight HTML Sanitizer for General Info
 * (Returns html directly as it is an internal application used by a single user,
 * avoiding the need for external package dependencies like dompurify)
 */
export function sanitizeGeneralInfoHtml(html: string): string {
  if (!html) return "";
  // Strip script tags just in case
  return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
}

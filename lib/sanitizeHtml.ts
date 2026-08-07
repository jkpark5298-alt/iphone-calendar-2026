/**
 * HTML sanitizer for general-info rich text / reports.
 * Strips scripts, event handlers, dangerous URLs and embeddable tags.
 */
const DANGEROUS_TAGS =
  /<\/?(?:script|iframe|object|embed|link|meta|form|input|button|textarea|select|base|svg|math|template|foreignObject)[^>]*>/gi;

const EVENT_HANDLER_ATTR =
  /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const DANGEROUS_URL_ATTR =
  /(\s+(?:href|src|xlink:href|action|formaction)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data\s*:\s*text\/html)[^"'>\s]*/gi;

export function sanitizeGeneralInfoHtml(html: string): string {
  if (!html) return "";

  let out = String(html);
  // Remove script/style blocks with content
  out = out.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  out = out.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  out = out.replace(DANGEROUS_TAGS, "");
  out = out.replace(EVENT_HANDLER_ATTR, "");
  out = out.replace(DANGEROUS_URL_ATTR, "$1$2#");
  // Neutralize srcdoc
  out = out.replace(/\s+srcdoc\s*=\s*(?:"[^"]*"|'[^']*')/gi, "");
  return out;
}

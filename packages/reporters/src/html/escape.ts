/**
 * Escaping helpers for the self-contained HTML report.
 * All dynamic text goes through escapeHtml; the JSON data island goes through
 * jsonForScript so a '</script>' inside report data can never break out.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialize a value for embedding inside <script type="application/json">.
 * '</' is escaped as '<\/' (a no-op for JSON.parse) so the embedded data can
 * never terminate the script element early.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

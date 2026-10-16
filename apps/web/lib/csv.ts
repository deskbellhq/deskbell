/**
 * One CSV cell. Quoted when it holds a comma, a quote or a line break; a
 * leading formula character is escaped so a spreadsheet shows the text
 * instead of evaluating it. Pure, so client and server code may share it.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

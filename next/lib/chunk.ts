export function splitHtmlByChars(html: string, limit: number, margin = 0.5): string[] {
  const safe = Math.max(1000, Math.floor(limit * margin));
  const chunks: string[] = [];
  let cur = "";
  for (const line of html.split(/(\n)/)) {
    if ((cur + line).length > safe) {
      chunks.push(cur);
      cur = "";
    }
    cur += line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}


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

// Basic HTML-aware chunking: split on closing tags for common block elements, then pack under char budget.
export function splitHtmlSmart(html: string, limit: number, margin = 0.5): string[] {
  const safe = Math.max(2000, Math.floor(limit * margin));
  const splitter = /(<\/(?:p|div|section|article|header|footer|li|ul|ol|table|thead|tbody|tfoot|tr|td|th|h[1-6])>)/gi;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = splitter.exec(html)) !== null) {
    const end = m.index + m[1].length;
    parts.push(html.slice(last, end));
    last = end;
  }
  if (last < html.length) parts.push(html.slice(last));

  if (parts.length === 0) return splitHtmlByChars(html, limit, margin);

  const chunks: string[] = [];
  let cur = "";
  for (const part of parts) {
    if ((cur + part).length > safe && cur.length > 0) {
      chunks.push(cur);
      cur = "";
    }
    cur += part;
  }
  if (cur) chunks.push(cur);

  // Fallback if we somehow produced oversized single parts
  const normalized: string[] = [];
  for (const c of chunks) {
    if (c.length > safe * 1.2) {
      normalized.push(...splitHtmlByChars(c, limit, margin));
    } else {
      normalized.push(c);
    }
  }
  return normalized;
}

export function shouldChunkQA(srcHtml: string, tgtHtml: string, thresholdChars = 20000): boolean {
  return (srcHtml.length + tgtHtml.length) > thresholdChars;
}

export function deterministicDomainSwap(html: string, oldDomain: string, newDomain: string): string {
  if (!oldDomain || !newDomain || oldDomain === newDomain) return html;
  return html.split(oldDomain).join(newDomain);
}


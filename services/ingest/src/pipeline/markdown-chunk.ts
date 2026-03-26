/**
 * Particiona Markdown en chunks semánticos (secciones por encabezado + tope de tamaño).
 */

export interface MarkdownChunk {
  chunkIndex: number;
  heading: string;
  text: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;

/**
 * Agrupa por bloques bajo cada ##+ y subdivide bloques largos por párrafos.
 * @param maxChars - Tamaño orientativo por chunk (caracteres).
 */
export function chunkMarkdown(source: string, maxChars = 1400): MarkdownChunk[] {
  const lines = source.split(/\r?\n/);
  const sections: { heading: string; bodyLines: string[] }[] = [];
  let currentHeading = '(intro)';
  let body: string[] = [];

  const flushBody = () => {
    const text = body.join('\n').trim();
    if (text.length > 0) sections.push({ heading: currentHeading, bodyLines: [...body] });
    body = [];
  };

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      flushBody();
      currentHeading = m[2].trim().slice(0, 200);
      body = [];
    } else {
      body.push(line);
    }
  }
  flushBody();

  const out: MarkdownChunk[] = [];
  let idx = 0;
  for (const sec of sections) {
    const full = sec.bodyLines.join('\n').trim();
    if (!full) continue;
    if (full.length <= maxChars) {
      out.push({ chunkIndex: idx++, heading: sec.heading, text: full });
      continue;
    }
    const paras = full.split(/\n{2,}/);
    let buf = '';
    const pushBuf = () => {
      const t = buf.trim();
      if (t.length === 0) return;
      out.push({ chunkIndex: idx++, heading: sec.heading, text: t.slice(0, 12000) });
      buf = '';
    };
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > maxChars && buf.length > 200) {
        pushBuf();
      }
      buf = buf ? `${buf}\n\n${p}` : p;
    }
    pushBuf();
  }
  return out;
}

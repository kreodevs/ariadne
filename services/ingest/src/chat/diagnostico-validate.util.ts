/**
 * Validación ligera post-LLM: rutas en markdown vs datos de fase A.
 */

export function collectAllowedPathsFromDiagnosticoDetails(details: unknown): Set<string> {
  const paths = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === 'string' && p.includes('/')) paths.add(p.replace(/\\/g, '/'));
  };
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x);
      return;
    }
    const rec = o as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      const v = rec[k];
      if (k === 'path' || k === 'fromPath' || k === 'toPath' || k === 'targetPath' || k === 'callerPath') {
        add(v);
      } else if (k === 'pathA' || k === 'pathB') {
        add(v);
      } else if (typeof v === 'object') walk(v);
    }
  };
  walk(details);
  return paths;
}

const PATH_IN_BACKTICK =
  /`((?:[\w@.\-]+\/)?[\w.\-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|css|scss|less|vue|svelte))`/gi;

export function appendDiagnosticoPathValidationFooter(markdown: string, details: unknown): string {
  const allowed = collectAllowedPathsFromDiagnosticoDetails(details);
  if (allowed.size === 0) return markdown;

  const unknown = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PATH_IN_BACKTICK.source, 'gi');
  while ((m = re.exec(markdown)) !== null) {
    const p = m[1]!.replace(/\\/g, '/');
    if (p.length < 4) continue;
    let ok = false;
    for (const a of allowed) {
      if (a === p || a.endsWith('/' + p) || p.endsWith(a) || a.endsWith(p)) {
        ok = true;
        break;
      }
    }
    if (!ok) unknown.add(p);
  }
  if (unknown.size === 0) return markdown;

  const sample = [...unknown].slice(0, 12);
  return `${markdown.trimEnd()}\n\n---\n_Validación (fase A): ${unknown.size} ruta(s) citadas en el texto no aparecen en el JSON de datos (${sample.map((x) => `\`${x}\``).join(', ')}${unknown.size > 12 ? ', …' : ''}). Priorizar tablas y listas derivadas de los datos anteriores._\n`;
}

/** Mensaje de error Archify para la UI (generate / sequence / compare). */
export function formatC4ArchifyFailure(opts: {
  htmlReady?: boolean;
  archifyError?: string | null;
  archifyBin?: string | null;
  fallback: string;
}): string {
  if (opts.htmlReady) return '';

  const detail = opts.archifyError?.trim();
  const hasCli = Boolean(opts.archifyBin?.trim());
  const layoutFailed = /layout validation failed/i.test(detail ?? '');

  let headline = opts.fallback;
  if (!hasCli) {
    headline =
      'Modelo C4 guardado pero HTML no generado. Configura la ruta de Archify en Ajustes → Sistema → C4 / Diagramas.';
  } else if (layoutFailed) {
    headline =
      'Modelo C4 guardado pero Archify rechazó el layout del diagrama. El CLI está configurado; vuelve a generar tras el último deploy del ingest.';
  } else if (detail) {
    headline =
      'Modelo C4 guardado pero HTML no generado. Revisa el detalle de Archify abajo.';
  }

  const lines = [headline];
  if (hasCli) lines.push(`CLI: ${opts.archifyBin}`);
  if (detail) lines.push(detail);
  return lines.join('\n');
}

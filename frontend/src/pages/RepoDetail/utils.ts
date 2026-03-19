/**
 * Formatea el payload del job para mostrar en la tabla (fase, archivos encontrados, indexados, omitidos, eliminados, commitSha).
 * @param payload - Objeto del job (phase, filesFound, current, total, indexed, skipped, deleted, commitSha).
 * @param status - Estado del job (queued, running, etc.) para mensajes contextuales.
 * @returns Texto legible para la celda de estado.
 */
export function formatJobPayload(
  payload: Record<string, unknown> | null | undefined,
  status?: string,
): string {
  if (!payload) return '—';
  const parts: string[] = [];
  if (status === 'queued' || payload.phase === 'queued') {
    parts.push('En cola…');
  }
  if (status === 'running') {
    if (payload.phase === 'mapping') parts.push('Listando archivos…');
    else if (payload.phase === 'mapping_done' && typeof payload.filesFound === 'number')
      parts.push(`${payload.filesFound} archivos encontrados`);
    else if (
      payload.phase === 'indexing' &&
      typeof payload.current === 'number' &&
      typeof payload.total === 'number'
    )
      parts.push(`Indexando ${payload.current}/${payload.total}`);
  }
  if (typeof payload.indexed === 'number') {
    const total = typeof payload.total === 'number' ? payload.total : payload.indexed;
    parts.push(`${payload.indexed}${total > payload.indexed ? `/${total}` : ''} indexados`);
  }
  if (typeof payload.skipped === 'number' && payload.skipped > 0) {
    parts.push(`${payload.skipped} omitidos`);
  }
  if (typeof payload.deleted === 'number') parts.push(`${payload.deleted} eliminados`);
  if (payload.commitSha) parts.push(`@${String(payload.commitSha).slice(0, 7)}`);
  return parts.length ? parts.join(' · ') : '—';
}

import { describe, it, expect } from 'vitest';
import { formatJobPayload } from './utils';

describe('formatJobPayload', () => {
  it('devuelve — sin payload', () => {
    expect(formatJobPayload(null)).toBe('—');
    expect(formatJobPayload(undefined)).toBe('—');
  });

  it('muestra fase en cola', () => {
    expect(formatJobPayload({ phase: 'queued' }, 'queued')).toContain('cola');
  });

  it('resume indexados y commit', () => {
    const s = formatJobPayload(
      { indexed: 10, total: 10, commitSha: 'abcdef1234567890' },
      'completed',
    );
    expect(s).toContain('10');
    expect(s).toContain('indexados');
    expect(s).toContain('@abcdef1');
  });
});

import { describe, expect, it } from 'vitest';
import {
  expandModificationPlanTermPairs,
  extractModificationPlanCypherTerms,
  normalizeModificationPlanToken,
} from './modification-plan-terms.util';

describe('modification-plan-terms', () => {
  it('normalizeModificationPlanToken quita acentos', () => {
    expect(normalizeModificationPlanToken('Acción')).toBe('accion');
  });

  it('excluye meta palabras como plan y mantiene primeflex', () => {
    const t = extractModificationPlanCypherTerms(
      'Quiero un plan de acción para reemplazar primeflex por tailwind en className',
    );
    expect(t.map((x) => x.toLowerCase())).not.toContain('plan');
    expect(t.map((x) => x.toLowerCase())).toContain('primeflex');
    expect(t.map((x) => x.toLowerCase())).toContain('tailwind');
    expect(t.map((x) => x.toLowerCase())).toContain('classname');
  });

  it('expandModificationPlanTermPairs añade variante capitalizada', () => {
    const pairs = expandModificationPlanTermPairs(['primeflex']);
    expect(pairs).toContain('primeflex');
    expect(pairs).toContain('Primeflex');
  });
});

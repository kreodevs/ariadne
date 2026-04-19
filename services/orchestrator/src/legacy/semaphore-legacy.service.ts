import { Injectable } from '@nestjs/common';
import type { MddEvidenceDocument } from './mdd-document.types';

/**
 * Semáforo de calidad del MDD frente a evidencia real (paths, OpenAPI, entidades).
 */
@Injectable()
export class SemaphoreService {
  validate(mdd: MddEvidenceDocument): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!mdd.evidence_paths?.length) {
      reasons.push('sin_evidence_paths');
    }
    if (mdd.openapi_spec?.found && mdd.api_contracts.length === 0) {
      reasons.push('openapi_spec_sin_operaciones');
    }
    if (mdd.risk_report?.complexity != null && mdd.risk_report.complexity > 85) {
      reasons.push('complejidad_elevada');
    }
    return { ok: reasons.length === 0, reasons };
  }
}

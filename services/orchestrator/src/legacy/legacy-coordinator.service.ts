import { Injectable } from '@nestjs/common';
import type { MddEvidenceDocument } from './mdd-document.types';
import { SemaphoreService } from './semaphore-legacy.service';

export interface LegacyIndexSddGateResult {
  blocked: boolean;
  reasons: string[];
}

export interface LegacyCoordinationOutcome {
  /** Mapa genérico para secciones del Workshop (títulos → contenido serializable). */
  workshopSections: Record<string, unknown>;
  /** Resultado del semáforo (calidad MDD vs índice). */
  semaphore: { ok: boolean; reasons: string[] };
  /** Indicador de coherencia dominio-grafo (heurística desde entidades + API). */
  sddDomainGraphOk: boolean;
  /** Gate de alineación índice ↔ SDD propuesto. */
  legacyIndexGate: LegacyIndexSddGateResult;
}

/**
 * The Forge / flujos legacy: consume el JSON de `ask_codebase` (evidence_first) y activa validadores.
 */
@Injectable()
export class LegacyCoordinatorService {
  constructor(private readonly semaphore: SemaphoreService) {}

  /**
   * `assertLegacyIndexSddGate`: bloquea si el diseño (SDD) diverge del código indexado (sin entidades ni contratos pese a evidencia mínima).
   */
  assertLegacyIndexSddGate(mdd: MddEvidenceDocument): LegacyIndexSddGateResult {
    const reasons: string[] = [];
    const paths = mdd.evidence_paths?.length ?? 0;
    const hasModels = (mdd.entities?.length ?? 0) > 0;
    const hasApi = (mdd.api_contracts?.length ?? 0) > 0;
    if (paths >= 3 && !hasModels && !hasApi) {
      reasons.push('divergence_index_vs_sdd: evidencia física sin modelos ni API en MDD');
      return { blocked: true, reasons };
    }
    return { blocked: false, reasons: [] };
  }

  mapToWorkshopSections(mdd: MddEvidenceDocument): Record<string, unknown> {
    return {
      section_1_summary: mdd.summary,
      section_2_openapi: mdd.openapi_spec,
      section_3_entities: mdd.entities,
      section_4_api_contracts: mdd.api_contracts,
      section_5_business_logic: mdd.business_logic,
      section_6_infrastructure: mdd.infrastructure,
      section_7_risk: mdd.risk_report,
      evidence_paths: mdd.evidence_paths,
    };
  }

  processMddFromAskCodebase(mdd: MddEvidenceDocument): LegacyCoordinationOutcome {
    const semaphore = this.semaphore.validate(mdd);
    const legacyIndexGate = this.assertLegacyIndexSddGate(mdd);
    const sddDomainGraphOk =
      semaphore.ok &&
      !legacyIndexGate.blocked &&
      ((mdd.entities?.length ?? 0) > 0 || (mdd.api_contracts?.length ?? 0) > 0 || (mdd.evidence_paths?.length ?? 0) >= 2);
    return {
      workshopSections: this.mapToWorkshopSections(mdd),
      semaphore,
      sddDomainGraphOk,
      legacyIndexGate,
    };
  }
}

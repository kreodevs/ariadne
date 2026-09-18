/** Target seleccionable en UI de workflow C4. */
export type C4WorkflowTargetKind =
  | 'sync-pipeline'
  | 'route-flow'
  | 'enum-status'
  | 'service-chain'
  | 'wizard'
  | 'job'
  | 'langgraph'
  | 'journey'
  | 'cron';

export interface C4WorkflowTargetOption {
  id: string;
  kind: C4WorkflowTargetKind;
  label: string;
  description: string;
  routePath?: string | null;
  sourcePath?: string | null;
  isDefault?: boolean;
}

/** Payload persistido en nodo :Flow de Falkor (fases 2–3). */
export interface IndexedFlowPayload {
  kind: C4WorkflowTargetKind;
  title: string;
  subtitle?: string;
  lanes: Array<{ id: string; label: string; variant?: string }>;
  mainPath: string[];
  nodes: Array<{
    id: string;
    lane: string;
    col: number;
    type: string;
    label: string;
    sublabel?: string;
  }>;
  edges: Array<{
    id: string;
    from: string;
    to: string;
    label?: string;
    variant?: 'default' | 'emphasis' | 'security' | 'dashed';
    role?: 'error' | 'branch' | 'return';
    route?: string;
    fromSide?: string;
    toSide?: string;
  }>;
}

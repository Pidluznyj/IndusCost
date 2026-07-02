export type SnapshotLineType = "EXISTING_COMPONENT" | "SIMULATED_COMPONENT" | "DIRECT_MATERIAL";

export type NewProductSnapshotLine = {
  id: string;
  type: SnapshotLineType;
  referenceId?: string;
  referenceLabel?: string;
  description?: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
  breakdown: {
    mp: number;
    hh: number;
    hm: number;
  };
};

export type NewProductSnapshotComponent = {
  id: string;
  name: string;
  sku?: string;
  hh: number;
  hm: number;
  costBase: number;
  mp: number;
  mpPct: number;
  hhPct: number;
  hmPct: number;
  processInputs?: {
    useDefaultHourCosts: boolean;
    cycleTimeSeconds?: number;
    cavities?: number;
    efficiencyExpectedPercent?: number;
    setupTimeMin?: number;
    lotSize?: number;
    manualHh?: number;
    manualHm?: number;
  };
  materials: Array<{
    code: string;
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
    total: number;
    /** aditivo: víncio opcional com Material (Suprimentos) */
    materialId?: string | null;
    source?: "CATALOG" | "MANUAL";
  }>;
};

export type NewProductSimulationSnapshot = {
  header: {
    simulationName: string;
    productName: string;
    productSku?: string;
    notes?: string;
    createdAt: string;
    savedAt: string;
    createdBy?: string;
    origin?: string;
  };
  commercial: {
    mode: "MARGIN" | "TARGET_PRICE";
    desiredMarginPct: number;
    targetPrice: number;
  };
  composition: {
    lines: NewProductSnapshotLine[];
    simulatedComponents: NewProductSnapshotComponent[];
  };
  result: {
    mp: number;
    hh: number;
    hm: number;
    costBase: number;
    mpPct: number;
    hhPct: number;
    hmPct: number;
    price: number;
    marginPct: number;
    viability: "VIAVEL" | "ATENCAO" | "INVIAVEL";
  };
};

export function buildSnapshotSaveData(input: {
  simulationName: string;
  createdBy?: string;
  origin?: string;
  snapshot: NewProductSimulationSnapshot;
}) {
  const now = new Date();
  const clone = structuredClone(input.snapshot);
  clone.header.savedAt = now.toISOString();

  return {
    name: input.simulationName,
    status: "SAVED" as const,
    productName: clone.header.productName,
    productSku: clone.header.productSku ?? null,
    notes: clone.header.notes ?? null,
    savedAt: now,
    createdBy: input.createdBy ?? null,
    origin: input.origin ?? null,
    snapshot: clone,
  };
}

export function buildCloneDraftData(saved: {
  id: string;
  name: string;
  snapshot: unknown;
}) {
  const clonedSnapshot = structuredClone(saved.snapshot) as NewProductSimulationSnapshot;
  return {
    name: `${saved.name} (cópia)`,
    status: "DRAFT" as const,
    sourceSimulationId: saved.id,
    productName: clonedSnapshot?.header?.productName ?? "Novo produto simulado",
    productSku: clonedSnapshot?.header?.productSku ?? null,
    notes: clonedSnapshot?.header?.notes ?? null,
    savedAt: null,
    snapshot: clonedSnapshot,
  };
}

export function editorModeFromStatus(status: "DRAFT" | "SAVED") {
  return status === "SAVED" ? "READONLY" : "EDITABLE";
}

/**
 * Normaliza `status` vindo do Prisma/API (incl. JSON) para o modo da tela.
 * Se `status` estiver ausente ou ambíguo, usa `savedAt`: registros congelados costumam ter data; rascunhos clonados vêm com `savedAt` null.
 */
export function persistedStatusFromApiRecord(row: { status?: unknown; savedAt?: unknown }): "DRAFT" | "SAVED" {
  const s = row?.status;
  if (s === "SAVED") return "SAVED";
  if (s === "DRAFT") return "DRAFT";
  if (typeof s === "string") {
    const u = s.trim().toUpperCase();
    if (u === "SAVED") return "SAVED";
    if (u === "DRAFT") return "DRAFT";
  }
  if (row.savedAt != null && row.savedAt !== "") return "SAVED";
  return "DRAFT";
}

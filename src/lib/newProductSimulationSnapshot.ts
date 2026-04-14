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
  materials: Array<{
    code: string;
    description: string;
    quantity: number;
    unit: string;
    unitCost: number;
    total: number;
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

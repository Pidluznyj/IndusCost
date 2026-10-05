import type { RecordedCostBaselineSource } from "./productCostBaseline.js";
import type { NewProductSimulationInputs } from "./simulationsValidation.js";

export type SnapshotLineType = "EXISTING_COMPONENT" | "SIMULATED_COMPONENT" | "DIRECT_MATERIAL";

/** Snapshot calculado e montado pelo SERVIDOR a partir de inputs (v2). Ausente = legado (navegador). */
export const NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION = 2 as const;

export const LEGACY_SNAPSHOT_NOTICE = "Snapshot legado — origem de custo não registrada";

/** Base de custo de uma linha de componente existente (referência do cenário, não custo oficial novo). */
export type NewProductSnapshotLineBaseline = {
  source: RecordedCostBaselineSource;
  productionCostVersionId: string | null;
  productionCostVersionCode: string | null;
  productionCostRevision: number | null;
  effectiveDate: string | null;
  calculatedAt: string | null;
  unitMp: number;
  unitHh: number;
  unitHm: number;
  warnings: string[];
};

export type NewProductSnapshotCommercialPremises = {
  taxRuleId: string | null;
  taxRuleName: string | null;
  taxRatePct: number;
  commissionRatePct: number;
  otherRatePct: number;
  freight: number;
};

export type NewProductSnapshotAnalysis = {
  /**
   * INDUSTRIAL_PRELIMINARY = só MP + HH + HM + margem industrial (sem impostos, comissão, frete).
   * COMMERCIAL_SIMULATED   = premissas comerciais DA SIMULAÇÃO aplicadas (nunca preço oficial).
   */
  kind: "INDUSTRIAL_PRELIMINARY" | "COMMERCIAL_SIMULATED";
  priceLabel: string;
  marginSign: "POSITIVA" | "NULA_OU_NEGATIVA" | "INDETERMINADA";
  markupFactor: number | null;
  markupPct: number | null;
  /** Premissas impossíveis (ex.: divisor ≤ 0) — nunca vira preço 0 silencioso. */
  error: { code: string; message: string } | null;
};

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
  /** v2 */
  unit?: string;
  referenceSku?: string | null;
  /** v2 — EXISTING_COMPONENT: base usada; DIRECT_MATERIAL: sempre digitado. */
  baseline?: NewProductSnapshotLineBaseline;
  costOrigin?: "EXISTING_PRODUCT" | "SIMULATED_COMPONENT" | "MANUAL_DIRECT";
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
  /** v2 — taxas e resultado do processo usados no cálculo (reprodutibilidade). */
  processResult?: {
    source: "DEFAULT" | "MANUAL";
    hhRatePerHour: number | null;
    hmRatePerHour: number | null;
    hhSource: "AUTO" | "MANUAL" | null;
    netPph: number | null;
    unitTransform: number | null;
    setupCost: number | null;
    totalStepCost: number | null;
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
    /** v2 — custo do cadastro no momento do cálculo e sinalização de sobrescrita manual. */
    catalogCurrentCost?: number | null;
    catalogFreight?: number | null;
    catalogStandardLossPct?: number | null;
    catalogEffectiveUnitCost?: number | null;
    costOverridden?: boolean;
    bomLossPct?: number;
    requiredQuantity?: number;
  }>;
};

export type NewProductSimulationSnapshot = {
  /** 2 = calculado pelo servidor; ausente = legado montado no navegador. */
  schemaVersion?: typeof NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION;
  /** Sempre snapshot de SIMULAÇÃO — nunca snapshot de custo oficial. */
  kind?: "SIMULATION_SNAPSHOT";
  /** v2 — inputs enviados pelo cliente (permitem reabrir rascunho e reproduzir o cálculo). */
  inputs?: NewProductSimulationInputs;
  /** v2 — taxas-hora da engenharia usadas no cálculo. */
  hourCosts?: {
    globalHhCostPerHour: number;
    machineHourCostPerHour: number;
    hhSource: "AUTO" | "MANUAL";
  } | null;
  header: {
    simulationName: string;
    productName: string;
    productSku?: string;
    notes?: string;
    createdAt: string;
    savedAt: string;
    createdBy?: string;
    createdByUserId?: string | null;
    origin?: string;
  };
  commercial: {
    mode: "MARGIN" | "TARGET_PRICE";
    desiredMarginPct: number;
    targetPrice: number;
    /** v2 — premissas comerciais DA SIMULAÇÃO; null = sem análise comercial. */
    premises?: NewProductSnapshotCommercialPremises | null;
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
    /** null quando as premissas tornam o preço impossível (ver analysis.error). */
    price: number | null;
    marginPct: number | null;
    /** Somente em snapshots legados. v2 usa `analysis` e não classifica "viável". */
    viability?: "VIAVEL" | "ATENCAO" | "INVIAVEL";
    analysis?: NewProductSnapshotAnalysis;
  };
};

export function isServerComputedSnapshot(snapshot: unknown): boolean {
  return (
    snapshot != null &&
    typeof snapshot === "object" &&
    (snapshot as { schemaVersion?: unknown }).schemaVersion === NEW_PRODUCT_SNAPSHOT_SCHEMA_VERSION
  );
}

/**
 * LEGADO: grava snapshot montado fora do servidor. As rotas não usam mais este caminho
 * (o servidor calcula a partir de inputs — ver newProductSimulation.server.ts).
 */
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

export type PersistedSimulationStatus = "DRAFT" | "SAVED" | "ARCHIVED";

export function editorModeFromStatus(status: PersistedSimulationStatus) {
  return status === "DRAFT" ? "EDITABLE" : "READONLY";
}

/** Nomes visíveis ao usuário — não confundir com DRAFT/PUBLISHED do custo oficial. */
export function simulationStatusLabel(status: PersistedSimulationStatus): string {
  if (status === "SAVED") return "Simulação congelada";
  if (status === "ARCHIVED") return "Arquivada";
  return "Rascunho da simulação";
}

/**
 * Normaliza `status` vindo do Prisma/API (incl. JSON) para o modo da tela.
 * Se `status` estiver ausente ou ambíguo, usa `savedAt`: registros congelados costumam ter data; rascunhos clonados vêm com `savedAt` null.
 */
export function persistedStatusFromApiRecord(row: { status?: unknown; savedAt?: unknown }): PersistedSimulationStatus {
  const s = row?.status;
  if (s === "SAVED") return "SAVED";
  if (s === "DRAFT") return "DRAFT";
  if (s === "ARCHIVED") return "ARCHIVED";
  if (typeof s === "string") {
    const u = s.trim().toUpperCase();
    if (u === "SAVED") return "SAVED";
    if (u === "DRAFT") return "DRAFT";
    if (u === "ARCHIVED") return "ARCHIVED";
  }
  if (row.savedAt != null && row.savedAt !== "") return "SAVED";
  return "DRAFT";
}

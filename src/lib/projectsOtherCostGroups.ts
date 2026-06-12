export const OTHER_COST_MARKER = "guided-other-cost";
export const OTHER_COST_BATCH_PREFIX = "batch:";

export type ProjectOtherCostGroupKey =
  | "DEVELOPMENT"
  | "PROTOTYPE"
  | "TEST"
  | "DEVICE"
  | "FREIGHT"
  | "SPECIAL_PACKAGING"
  | "OUTSOURCING"
  | "TRAVEL"
  | "DOCUMENTATION"
  | "OTHER";

export const OTHER_COST_GROUP_LABEL: Record<ProjectOtherCostGroupKey, string> = {
  DEVELOPMENT: "Desenvolvimento",
  PROTOTYPE: "Protótipo",
  TEST: "Teste",
  DEVICE: "Dispositivo",
  FREIGHT: "Frete",
  SPECIAL_PACKAGING: "Embalagem especial",
  OUTSOURCING: "Terceirização",
  TRAVEL: "Viagem",
  DOCUMENTATION: "Documentação",
  OTHER: "Outro",
};

export type ProjectOtherCostLine = {
  id: string;
  group: ProjectOtherCostGroupKey;
  description: string;
  supplierName: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  notes: string | null;
};

export function isGuidedOtherCostItem(notes: string | null | undefined): boolean {
  return notes?.includes(OTHER_COST_MARKER) === true;
}

export function parseOtherCostMeta(notes: string | null | undefined): {
  group: ProjectOtherCostGroupKey;
  batchId: string | null;
} {
  const groupMatch = notes?.match(/group:([A-Z_]+)/);
  const batchMatch = notes?.match(/batch:([a-z0-9-]+)/i);
  const group = (groupMatch?.[1] as ProjectOtherCostGroupKey | undefined) ?? "OTHER";
  return {
    group: group in OTHER_COST_GROUP_LABEL ? group : "OTHER",
    batchId: batchMatch?.[1] ?? null,
  };
}

export function buildOtherCostNotes(
  group: ProjectOtherCostGroupKey,
  batchId: string,
  lineNotes?: string | null
): string {
  const base = `${OTHER_COST_MARKER}\ngroup:${group}\n${OTHER_COST_BATCH_PREFIX}${batchId}`;
  const extra = lineNotes?.trim();
  return extra ? `${base}\n${extra}` : base;
}

export function computeOtherCostLineTotal(quantity: number, unitCost: number): number {
  const q = Number.isFinite(quantity) ? quantity : 0;
  const u = Number.isFinite(unitCost) ? unitCost : 0;
  return q * u;
}

export function createEmptyOtherCostLine(
  group: ProjectOtherCostGroupKey = "OTHER"
): ProjectOtherCostLine {
  return {
    id: crypto.randomUUID(),
    group,
    description: "",
    supplierName: null,
    quantity: 1,
    unit: "UN",
    unitCost: 0,
    totalCost: 0,
    notes: null,
  };
}

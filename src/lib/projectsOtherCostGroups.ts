import { createBrowserSafeId } from "@/src/lib/browserSafeId";
import type { ProjectSimulatedItemRow } from "@/src/types/projects";

export const OTHER_COST_MARKER = "guided-other-cost";
export const OTHER_COST_BATCH_PREFIX = "batch:";
export const OTHER_COST_LINE_PREFIX = "__OTHER_COST_LINE__=";
export const OTHER_COST_USER_NOTES_PREFIX = "__USER_NOTES__=";

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

export type OtherCostLinePersistedDetail = {
  quantity: number;
  unitCost: number;
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

export function parseOtherCostLineDetail(
  notes: string | null | undefined
): OtherCostLinePersistedDetail | null {
  if (!notes?.trim()) return null;
  for (const part of notes.split("\n")) {
    if (!part.startsWith(OTHER_COST_LINE_PREFIX)) continue;
    try {
      const parsed = JSON.parse(part.slice(OTHER_COST_LINE_PREFIX.length)) as OtherCostLinePersistedDetail;
      const quantity = Number(parsed.quantity);
      const unitCost = Number(parsed.unitCost);
      if (!Number.isFinite(quantity) || !Number.isFinite(unitCost)) return null;
      if (quantity <= 0) return null;
      return { quantity, unitCost };
    } catch {
      return null;
    }
  }
  return null;
}

export function parseOtherCostUserNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  for (const part of notes.split("\n")) {
    if (part.startsWith(OTHER_COST_USER_NOTES_PREFIX)) {
      return part.slice(OTHER_COST_USER_NOTES_PREFIX.length).trim() || null;
    }
  }
  return null;
}

export function buildOtherCostNotes(
  group: ProjectOtherCostGroupKey,
  batchId: string,
  detail?: {
    quantity: number;
    unitCost: number;
    userNotes?: string | null;
  }
): string {
  const parts = [OTHER_COST_MARKER, `group:${group}`, `${OTHER_COST_BATCH_PREFIX}${batchId}`];
  if (detail && Number.isFinite(detail.quantity) && Number.isFinite(detail.unitCost) && detail.quantity > 0) {
    parts.push(
      `${OTHER_COST_LINE_PREFIX}${JSON.stringify({
        quantity: detail.quantity,
        unitCost: detail.unitCost,
      })}`
    );
  }
  const userNotes = detail?.userNotes?.trim();
  if (userNotes) parts.push(`${OTHER_COST_USER_NOTES_PREFIX}${userNotes}`);
  return parts.join("\n");
}

export function computeOtherCostLineTotal(quantity: number, unitCost: number): number {
  const q = Number.isFinite(quantity) ? quantity : 0;
  const u = Number.isFinite(unitCost) ? unitCost : 0;
  const total = q * u;
  if (!Number.isFinite(total)) return 0;
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

export function sumOtherCostLines(lines: ProjectOtherCostLine[]): number {
  return lines.reduce((acc, line) => acc + computeOtherCostLineTotal(line.quantity, line.unitCost), 0);
}

export function resolveOtherCostItemLineTotal(item: ProjectSimulatedItemRow): number {
  const detail = parseOtherCostLineDetail(item.notes);
  if (detail) {
    return computeOtherCostLineTotal(detail.quantity, detail.unitCost);
  }
  const stored = item.quotedUnitCost ?? item.estimatedUnitCost ?? 0;
  return Number.isFinite(stored) ? stored : 0;
}

export function createEmptyOtherCostLine(
  group: ProjectOtherCostGroupKey = "OTHER"
): ProjectOtherCostLine {
  return {
    id: createBrowserSafeId("other-cost-line"),
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

export function simulatedItemToOtherCostLine(item: ProjectSimulatedItemRow): ProjectOtherCostLine {
  const meta = parseOtherCostMeta(item.notes);
  const detail = parseOtherCostLineDetail(item.notes);
  const storedTotal = item.quotedUnitCost ?? item.estimatedUnitCost ?? 0;

  if (detail) {
    return {
      id: item.id,
      group: meta.group,
      description: item.description,
      supplierName: item.supplierName,
      quantity: detail.quantity,
      unit: item.unit,
      unitCost: detail.unitCost,
      totalCost: computeOtherCostLineTotal(detail.quantity, detail.unitCost),
      notes: parseOtherCostUserNotes(item.notes),
    };
  }

  return {
    id: item.id,
    group: meta.group,
    description: item.description,
    supplierName: item.supplierName,
    quantity: 1,
    unit: item.unit,
    unitCost: storedTotal,
    totalCost: storedTotal,
    notes: parseOtherCostUserNotes(item.notes),
  };
}

export function loadOtherCostBatchLines(
  items: ProjectSimulatedItemRow[],
  batchId: string
): ProjectOtherCostLine[] {
  return items
    .filter((item) => isGuidedOtherCostItem(item.notes) && parseOtherCostMeta(item.notes).batchId === batchId)
    .map(simulatedItemToOtherCostLine);
}

export function findOtherCostBatchItems(
  items: ProjectSimulatedItemRow[],
  batchId: string
): ProjectSimulatedItemRow[] {
  return items.filter(
    (item) => isGuidedOtherCostItem(item.notes) && parseOtherCostMeta(item.notes).batchId === batchId
  );
}

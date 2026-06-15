import { createBrowserSafeId } from "@/src/lib/browserSafeId";
import { calculateStructureLineTotalCost } from "@/src/lib/projectsCalculations";

export type ProjectMoldCostLineType =
  | "MATERIAL"
  | "SERVICE"
  | "THIRD_PARTY"
  | "MACHINING"
  | "EDM"
  | "WELDING"
  | "TREATMENT"
  | "OTHER";

export type ProjectMoldCostLine = {
  id: string;
  description: string;
  lineType: ProjectMoldCostLineType;
  supplierName: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  notes: string | null;
};

export const MOLD_COST_LINES_PREFIX = "__MOLD_LINES__=";
export const MOLD_USER_NOTES_PREFIX = "__USER_NOTES__=";

export function computeMoldLineTotal(quantity: number, unitCost: number): number {
  return calculateStructureLineTotalCost(quantity, unitCost, 0);
}

export function sumMoldCostLines(lines: ProjectMoldCostLine[]): number {
  return lines.reduce((acc, line) => acc + (Number.isFinite(line.totalCost) ? line.totalCost : 0), 0);
}

export function serializeMoldNotes(lines: ProjectMoldCostLine[], userNotes?: string | null): string | null {
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`${MOLD_COST_LINES_PREFIX}${JSON.stringify(lines)}`);
  }
  const trimmed = userNotes?.trim();
  if (trimmed) parts.push(`${MOLD_USER_NOTES_PREFIX}${trimmed}`);
  return parts.length ? parts.join("\n") : null;
}

export function parseMoldNotes(notes: string | null | undefined): {
  lines: ProjectMoldCostLine[];
  userNotes: string | null;
} {
  if (!notes?.trim()) return { lines: [], userNotes: null };
  const lines: ProjectMoldCostLine[] = [];
  let userNotes: string | null = null;
  for (const part of notes.split("\n")) {
    if (part.startsWith(MOLD_COST_LINES_PREFIX)) {
      try {
        const parsed = JSON.parse(part.slice(MOLD_COST_LINES_PREFIX.length)) as ProjectMoldCostLine[];
        if (Array.isArray(parsed)) lines.push(...parsed);
      } catch {
        // ignore invalid json
      }
    } else if (part.startsWith(MOLD_USER_NOTES_PREFIX)) {
      userNotes = part.slice(MOLD_USER_NOTES_PREFIX.length).trim() || null;
    }
  }
  return { lines, userNotes };
}

/** Texto legível para exibição — oculta payload serializado __MOLD_LINES__. */
export function formatMoldDescriptionForDisplay(
  notes: string | null | undefined,
  moldType?: string | null,
  fallback = "Não informado"
): string {
  const { userNotes } = parseMoldNotes(notes);
  if (userNotes?.trim()) return userNotes.trim();
  if (moldType?.trim()) return moldType.trim();
  return fallback;
}

export function createEmptyMoldLine(): ProjectMoldCostLine {
  return {
    id: createBrowserSafeId("mold-line"),
    description: "",
    lineType: "MATERIAL",
    supplierName: null,
    quantity: 1,
    unit: "UN",
    unitCost: 0,
    totalCost: 0,
    notes: null,
  };
}

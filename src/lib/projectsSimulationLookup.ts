import type { Prisma } from "@prisma/client";
import type { NewProductSimulationSnapshot } from "@/src/lib/newProductSimulationSnapshot";
import { persistedStatusFromApiRecord } from "@/src/lib/newProductSimulationSnapshot";
import { resolveSimulationSnapshotUnitCost } from "@/src/lib/projectsSimulationRefs";

export type ProjectSimulationLookupRow = {
  id: string;
  name: string;
  productName: string;
  productSku: string | null;
  status: "DRAFT" | "SAVED";
  statusLabel: string;
  savedAt: string | null;
  updatedAt: string | null;
  unitCost: number | null;
  totalCost: number | null;
  margin: number | null;
  selectable: boolean;
  selectionBlockedReason: string | null;
  missingCost: boolean;
  source: "SIMULATION";
};

export type SimulationLookupRecord = {
  id: string;
  name: string;
  productName: string;
  productSku: string | null;
  status: string;
  notes: string | null;
  savedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  snapshot: unknown;
};

/** Normaliza texto para busca accent-insensitive. */
export function normalizeSimulationSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/** Quebra consulta em tokens (mín. 2 caracteres cada). */
export function tokenizeSimulationSearchQuery(query: string): string[] {
  return normalizeSimulationSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

export function buildSimulationSearchHaystack(row: SimulationLookupRecord): string {
  const snapshot = row.snapshot as NewProductSimulationSnapshot | null;
  const header = snapshot?.header;
  return [
    row.name,
    row.productName,
    row.productSku,
    row.notes,
    header?.simulationName,
    header?.productName,
    header?.productSku,
    header?.notes,
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ");
}

export function matchesSimulationSearchTokens(
  row: SimulationLookupRecord,
  tokens: string[]
): boolean {
  if (tokens.length === 0) return true;
  const haystack = normalizeSimulationSearchText(buildSimulationSearchHaystack(row));
  return tokens.every((token) => haystack.includes(token));
}

/** Prisma WHERE para pré-filtrar candidatos no banco (mesma tabela da tela Simulações). */
export function buildSimulationLookupPrismaWhere(
  query: string
): Prisma.NewProductSimulationWhereInput | undefined {
  const tokens = tokenizeSimulationSearchQuery(query);
  if (tokens.length === 0) return undefined;

  const or: Prisma.NewProductSimulationWhereInput[] = [];
  for (const token of tokens) {
    or.push(
      { name: { contains: token, mode: "insensitive" } },
      { productName: { contains: token, mode: "insensitive" } },
      { productSku: { contains: token, mode: "insensitive" } },
      { notes: { contains: token, mode: "insensitive" } }
    );
  }
  return { OR: or };
}

function resolveSimulationSnapshotPrice(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const price = (snapshot as NewProductSimulationSnapshot).result?.price;
  return typeof price === "number" && Number.isFinite(price) ? price : null;
}

function resolveSimulationSnapshotMargin(snapshot: unknown): number | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const marginPct = (snapshot as NewProductSimulationSnapshot).result?.marginPct;
  return typeof marginPct === "number" && Number.isFinite(marginPct) ? marginPct : null;
}

export function serializeSimulationLookupRow(row: SimulationLookupRecord): ProjectSimulationLookupRow {
  const status = persistedStatusFromApiRecord(row);
  const unitCost = resolveSimulationSnapshotUnitCost(row.snapshot);
  const totalCost = resolveSimulationSnapshotPrice(row.snapshot);
  const margin = resolveSimulationSnapshotMargin(row.snapshot);
  const missingCost = unitCost == null;

  let selectable = false;
  let selectionBlockedReason: string | null = null;

  if (status === "DRAFT") {
    selectionBlockedReason =
      "Simulação em rascunho — salve em Simulações → Simular novo produto antes de adicionar ao projeto.";
  } else if (missingCost) {
    selectionBlockedReason = "Simulação sem custo industrial calculado no snapshot.";
  } else {
    selectable = true;
  }

  return {
    id: row.id,
    name: row.name,
    productName: row.productName,
    productSku: row.productSku,
    status,
    statusLabel: status === "SAVED" ? "Salvo" : "Rascunho",
    savedAt: row.savedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? row.createdAt?.toISOString() ?? null,
    unitCost,
    totalCost,
    margin,
    selectable,
    selectionBlockedReason,
    missingCost,
    source: "SIMULATION",
  };
}

export function filterAndSerializeSimulationLookupRows(
  rows: SimulationLookupRecord[],
  query: string
): ProjectSimulationLookupRow[] {
  const tokens = tokenizeSimulationSearchQuery(query);
  const filtered = rows.filter((row) => matchesSimulationSearchTokens(row, tokens));
  return filtered.map(serializeSimulationLookupRow);
}

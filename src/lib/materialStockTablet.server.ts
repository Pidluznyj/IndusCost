/**
 * Serviço de listagem/pesquisa tablet — Conferência de Estoque.
 * Select mínimo, sem relações pesadas, sem custos.
 *
 * SoT de quantidade para MPs vinculadas ao Inventory:
 * - Se existir InventoryItem ACTIVE (materialId + RAW_MATERIAL), o saldo
 *   exibido vem da soma de InventoryBalance.physicalQuantity (batch).
 * - Material.quantity permanece para MPs sem vínculo / legado.
 * - Este serviço NÃO escreve Material.quantity nem InventoryBalance.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeSearchString } from "@/src/lib/utils.js";
import type { MaterialStockTabletSearchQuery } from "./materialStockTabletQuery.js";
import {
  computeStockStatusForTabletRow,
  serializeMaterialStockTabletListItem,
  type MaterialStockTabletDbRow,
} from "./materialStockTabletSerialization.js";
import type { MaterialStockTabletSearchResponse } from "./materialStockTabletTypes.js";

const TABLET_SELECT = {
  id: true,
  code: true,
  description: true,
  unit: true,
  quantity: true,
  contingencyQuantity: true,
  minimumQuantity: true,
  recommendedQuantity: true,
  lastStockConferenceAt: true,
  lastStockConferenceUserId: true,
  stockConferenceVersion: true,
  updatedAt: true,
} as const;

/** Cap de candidatos quando há filtro pós-DB (texto com acento / stockStatus). */
const IN_MEMORY_CANDIDATE_CAP = 5000;

export function materialStockTabletTextMatches(
  code: string,
  description: string,
  query: string
): boolean {
  const nq = normalizeSearchString(query);
  if (!nq) return true;
  return (
    normalizeSearchString(code).includes(nq) ||
    normalizeSearchString(description).includes(nq)
  );
}

function buildPrismaWhere(
  query: MaterialStockTabletSearchQuery,
  now: Date
): Prisma.MaterialWhereInput {
  const and: Prisma.MaterialWhereInput[] = [];

  if (query.materialStatus === "ACTIVE") {
    and.push({ status: "ACTIVE" });
  } else if (query.materialStatus === "INACTIVE") {
    and.push({ status: "INACTIVE" });
  }

  // Texto (código/descrição) é filtrado em memória com normalizeSearchString
  // (case + acentos). Evita depender de extensão unaccent no PostgreSQL.

  if (query.missingLevels) {
    and.push({
      OR: [
        { contingencyQuantity: null },
        { minimumQuantity: null },
        { recommendedQuantity: null },
      ],
    });
  }

  if (query.staleConference) {
    const cutoff = new Date(now.getTime() - query.staleDays * 24 * 60 * 60 * 1000);
    and.push({
      OR: [{ lastStockConferenceAt: null }, { lastStockConferenceAt: { lt: cutoff } }],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

async function resolveUserDisplayNames(
  db: PrismaClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const users = await db.appUser.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  });
  for (const u of users) {
    map.set(u.id, u.name?.trim() || u.email?.trim() || u.id);
  }
  return map;
}

function needsInMemoryPipeline(query: MaterialStockTabletSearchQuery): boolean {
  return Boolean(query.q) || query.stockStatus != null;
}

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/**
 * Para MPs com InventoryItem vinculado, sobrescreve `quantity` com a soma
 * batch de InventoryBalance.physicalQuantity. Sem writes.
 */
async function applyLinkedInventoryBalanceQuantities(
  db: PrismaClient,
  rows: MaterialStockTabletDbRow[]
): Promise<MaterialStockTabletDbRow[]> {
  if (rows.length === 0) return rows;
  const materialIds = rows.map((r) => r.id);
  const items = await db.inventoryItem.findMany({
    where: {
      materialId: { in: materialIds },
      status: "ACTIVE",
      itemType: "RAW_MATERIAL",
    },
    select: { id: true, materialId: true },
  });
  if (items.length === 0) return rows;

  const itemIds = items.map((i) => i.id);
  const balances = await db.inventoryBalance.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, physicalQuantity: true },
  });

  const qtyByItem = new Map<string, number>();
  for (const b of balances) {
    const prev = qtyByItem.get(b.itemId) ?? 0;
    const n = Number(b.physicalQuantity);
    qtyByItem.set(b.itemId, prev + (Number.isFinite(n) ? n : 0));
  }

  const qtyByMaterial = new Map<string, number>();
  for (const item of items) {
    if (!item.materialId) continue;
    const itemQty = qtyByItem.get(item.id) ?? 0;
    qtyByMaterial.set(item.materialId, (qtyByMaterial.get(item.materialId) ?? 0) + itemQty);
  }

  return rows.map((row) => {
    if (!qtyByMaterial.has(row.id)) return row;
    return { ...row, quantity: qtyByMaterial.get(row.id) ?? 0 };
  });
}

export async function searchMaterialStockTablet(
  db: PrismaClient,
  query: MaterialStockTabletSearchQuery,
  now: Date = new Date()
): Promise<MaterialStockTabletSearchResponse> {
  const where = buildPrismaWhere(query, now);

  if (!needsInMemoryPipeline(query)) {
    const [total, rawRows] = await Promise.all([
      db.material.count({ where }),
      db.material.findMany({
        where,
        select: TABLET_SELECT,
        // Conferência no tablet: prioriza maior saldo em estoque.
        orderBy: [{ quantity: "desc" }, { code: "asc" }],
        skip: query.skip,
        take: query.pageSize,
      }),
    ]);
    const rows = await applyLinkedInventoryBalanceQuantities(
      db,
      rawRows as MaterialStockTabletDbRow[]
    );
    const nameMap = await resolveUserDisplayNames(
      db,
      rows.map((r) => r.lastStockConferenceUserId).filter((id): id is string => Boolean(id))
    );
    return {
      rows: rows.map((r) => serializeMaterialStockTabletListItem(r, nameMap)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize) || 1),
    };
  }

  const candidates = await db.material.findMany({
    where,
    select: TABLET_SELECT,
    orderBy: [{ quantity: "desc" }, { code: "asc" }],
    take: IN_MEMORY_CANDIDATE_CAP,
  });

  let filtered = await applyLinkedInventoryBalanceQuantities(
    db,
    candidates as MaterialStockTabletDbRow[]
  );
  if (query.q) {
    filtered = filtered.filter((row) =>
      materialStockTabletTextMatches(row.code, row.description, query.q)
    );
  }
  if (query.stockStatus) {
    filtered = filtered.filter(
      (row) => computeStockStatusForTabletRow(row) === query.stockStatus
    );
  }

  filtered = [...filtered].sort((a, b) => {
    const qtyDiff = Number(b.quantity) - Number(a.quantity);
    if (qtyDiff !== 0) return qtyDiff;
    return String(a.code).localeCompare(String(b.code), "pt-BR");
  });

  const total = filtered.length;
  const pageRows = paginateRows(filtered, query.page, query.pageSize);
  const nameMap = await resolveUserDisplayNames(
    db,
    pageRows
      .map((r) => r.lastStockConferenceUserId)
      .filter((id): id is string => Boolean(id))
  );

  return {
    rows: pageRows.map((r) => serializeMaterialStockTabletListItem(r, nameMap)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize) || 1),
  };
}

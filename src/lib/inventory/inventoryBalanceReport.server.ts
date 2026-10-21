/**
 * Carga do relatório de saldos de estoque. Somente leitura.
 * Usa os mesmos filtros da consulta de saldos (Estoque › Saldos).
 * Não cria, atualiza nem exclui InventoryBalance / InventoryMovement.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildInventoryBalanceReport,
  type InventoryBalanceReport,
  type InventoryBalanceReportFilter,
  type InventoryBalanceReportSourceLine,
} from "./inventoryBalanceReport.js";
import { INVENTORY_ITEM_TYPE_LABELS } from "./inventoryItemTypeLabels.js";
import type {
  InventoryBalanceReportQuery,
  InventoryBalanceReportZeroMode,
  InventoryBalancesListQuery,
} from "./inventoryListQuery.js";
import { inventoryDec, inventoryDecOrNull } from "./inventorySerialization.server.js";

type BalanceFilterQuery = Omit<InventoryBalancesListQuery, "page" | "pageSize" | "skip">;

export type InventoryBalanceReportLoadQuery = BalanceFilterQuery & {
  zeroBalanceMode?: InventoryBalanceReportZeroMode;
};

/** Filtros de cadastro do item compartilhados entre saldo e catálogo. */
export function buildInventoryItemWhereFromBalanceQuery(
  q: BalanceFilterQuery
): Prisma.InventoryItemWhereInput {
  return {
    ...(q.itemType ? { itemType: q.itemType } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...((q.families ?? []).length > 0
      ? { family: { in: q.families, mode: "insensitive" } }
      : q.family
        ? { family: { contains: q.family, mode: "insensitive" } }
        : {}),
    ...(q.group ? { group: { contains: q.group, mode: "insensitive" } } : {}),
    ...(q.search
      ? {
          OR: [
            { code: { contains: q.search, mode: "insensitive" } },
            { description: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

/** Filtro de saldos compartilhado entre a consulta (Estoque › Saldos) e o relatório. */
export function buildInventoryBalancesWhere(q: BalanceFilterQuery): Prisma.InventoryBalanceWhereInput {
  const itemWhere = buildInventoryItemWhereFromBalanceQuery(q);

  return {
    ...(q.itemId ? { itemId: q.itemId } : {}),
    ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
    ...(q.locationId ? { locationId: q.locationId } : {}),
    ...(q.hasReservation ? { reservedQuantity: { gt: 0 } } : {}),
    ...(q.hasBlocked ? { blockedQuantity: { gt: 0 } } : {}),
    ...(q.hasQuarantine ? { quarantineQuantity: { gt: 0 } } : {}),
    ...(q.negativeStock
      ? {
          OR: [{ physicalQuantity: { lt: 0 } }, { availableQuantity: { lt: 0 } }],
        }
      : {}),
    ...(Object.keys(itemWhere).length ? { item: itemWhere } : {}),
  };
}

/**
 * Itens só de cadastro (sem InventoryBalance) só entram no modo que inclui zerados,
 * e nunca para satisfazer filtro de local, reserva, bloqueio, quarentena, negativo
 * ou abaixo do mínimo/reposição — esses exigem evidência de saldo inexistente.
 */
export function canIncludeCatalogZeroItems(q: InventoryBalanceReportLoadQuery): boolean {
  return (
    q.zeroBalanceMode === "including_zero" &&
    !q.locationId &&
    !q.hasReservation &&
    !q.hasBlocked &&
    !q.hasQuarantine &&
    !q.negativeStock &&
    !q.belowMinimum &&
    !q.belowReorderPoint
  );
}

export function buildCatalogZeroItemsWhere(
  q: InventoryBalanceReportLoadQuery
): Prisma.InventoryItemWhereInput {
  const itemWhere = buildInventoryItemWhereFromBalanceQuery(q);
  return {
    controlsStock: true,
    ...itemWhere,
    ...(q.itemId ? { id: q.itemId } : {}),
    ...(q.warehouseId ? { defaultWarehouseId: q.warehouseId } : {}),
  };
}

type ReportDb = Pick<
  PrismaClient,
  "inventoryBalance" | "inventoryCountLine" | "inventoryWarehouse" | "inventoryLocation" | "inventoryItem"
>;

async function describeFilters(db: ReportDb, q: BalanceFilterQuery): Promise<InventoryBalanceReportFilter[]> {
  const [warehouse, location, item] = await Promise.all([
    q.warehouseId
      ? db.inventoryWarehouse.findUnique({ where: { id: q.warehouseId }, select: { code: true, name: true } })
      : null,
    q.locationId
      ? db.inventoryLocation.findUnique({ where: { id: q.locationId }, select: { code: true, name: true } })
      : null,
    q.itemId
      ? db.inventoryItem.findUnique({ where: { id: q.itemId }, select: { code: true, description: true } })
      : null,
  ]);

  const filters: InventoryBalanceReportFilter[] = [];
  if (q.search) filters.push({ label: "Busca", value: q.search });
  if (q.itemId) filters.push({ label: "Item", value: item ? `${item.code} — ${item.description}` : q.itemId });
  if (q.itemType) filters.push({ label: "Tipo", value: INVENTORY_ITEM_TYPE_LABELS[q.itemType] });
  if ((q.families ?? []).length > 0) filters.push({ label: "Famílias", value: q.families.join(" · ") });
  else if (q.family) filters.push({ label: "Família", value: q.family });
  if (q.group) filters.push({ label: "Grupo", value: q.group });
  if (q.warehouseId) {
    filters.push({
      label: "Almoxarifado",
      value: warehouse ? `${warehouse.code} — ${warehouse.name}` : q.warehouseId,
    });
  }
  if (q.locationId) {
    filters.push({ label: "Local", value: location ? `${location.code} — ${location.name}` : q.locationId });
  }
  if (q.status) filters.push({ label: "Status do item", value: q.status === "ACTIVE" ? "Ativo" : "Inativo" });

  const flags = [
    q.belowMinimum ? "Abaixo do mínimo" : null,
    q.belowReorderPoint ? "Abaixo do ponto de reposição" : null,
    q.hasReservation ? "Com reserva" : null,
    q.hasBlocked ? "Com bloqueio" : null,
    q.hasQuarantine ? "Em quarentena" : null,
    q.negativeStock ? "Saldo negativo" : null,
  ].filter((flag): flag is string => flag != null);
  if (flags.length > 0) filters.push({ label: "Somente", value: flags.join(" · ") });
  return filters;
}

export async function loadInventoryBalanceReport(
  db: ReportDb,
  q: InventoryBalanceReportLoadQuery | InventoryBalanceReportQuery | BalanceFilterQuery,
  generatedAt = new Date()
): Promise<InventoryBalanceReport> {
  const zeroBalanceMode: InventoryBalanceReportZeroMode =
    "zeroBalanceMode" in q && q.zeroBalanceMode ? q.zeroBalanceMode : "legacy";
  const balances = await db.inventoryBalance.findMany({
    where: buildInventoryBalancesWhere(q),
    select: {
      physicalQuantity: true,
      availableQuantity: true,
      lastMovementAt: true,
      item: {
        select: {
          id: true,
          code: true,
          description: true,
          unit: true,
          itemType: true,
          minimumStock: true,
          reorderPoint: true,
        },
      },
    },
  });

  // Mesmo critério linha a linha da consulta de saldos.
  const filtered = balances.filter((row) => {
    const available = inventoryDec(row.availableQuantity);
    const minimum = inventoryDecOrNull(row.item.minimumStock);
    const reorder = inventoryDecOrNull(row.item.reorderPoint);
    if (q.belowMinimum && (minimum == null || available >= minimum)) return false;
    if (q.belowReorderPoint && (reorder == null || available >= reorder)) return false;
    return true;
  });

  const lines: InventoryBalanceReportSourceLine[] = filtered.map((row) => ({
    itemId: row.item.id,
    code: row.item.code,
    description: row.item.description,
    unit: row.item.unit,
    itemType: row.item.itemType,
    physicalQuantity: inventoryDec(row.physicalQuantity),
    lastMovementAt: row.lastMovementAt,
  }));

  const seenItemIds = new Set(lines.map((line) => line.itemId));

  if (canIncludeCatalogZeroItems({ ...q, zeroBalanceMode })) {
    const catalogItems = await db.inventoryItem.findMany({
      where: buildCatalogZeroItemsWhere({ ...q, zeroBalanceMode }),
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        itemType: true,
      },
    });
    for (const item of catalogItems) {
      if (seenItemIds.has(item.id)) continue;
      seenItemIds.add(item.id);
      lines.push({
        itemId: item.id,
        code: item.code,
        description: item.description,
        unit: item.unit,
        itemType: item.itemType,
        physicalQuantity: 0,
        lastMovementAt: null,
      });
    }
  }

  const itemIds = [...seenItemIds];
  const countLines =
    itemIds.length === 0
      ? []
      : await db.inventoryCountLine.findMany({
          where: {
            itemId: { in: itemIds },
            countedQuantity: { not: null },
            session: { status: { not: "CANCELED" } },
            ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
            ...(q.locationId ? { locationId: q.locationId } : {}),
          },
          select: {
            itemId: true,
            updatedAt: true,
            currentObservation: { select: { observedAt: true } },
          },
        });

  const lastCountAtByItemId = new Map<string, Date>();
  for (const line of countLines) {
    // Linhas legadas não têm observação: vale a data em que a linha foi contada.
    const countedAt = line.currentObservation?.observedAt ?? line.updatedAt;
    const current = lastCountAtByItemId.get(line.itemId);
    if (!current || countedAt.getTime() > current.getTime()) lastCountAtByItemId.set(line.itemId, countedAt);
  }

  return buildInventoryBalanceReport({
    lines,
    lastCountAtByItemId,
    filters: await describeFilters(db, q),
    generatedAt,
    zeroBalanceMode,
  });
}

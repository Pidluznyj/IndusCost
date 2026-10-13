/**
 * Carga do relatório de saldos de estoque. Somente leitura.
 * Usa os mesmos filtros da consulta de saldos (Estoque › Saldos).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildInventoryBalanceReport,
  type InventoryBalanceReport,
  type InventoryBalanceReportFilter,
} from "./inventoryBalanceReport.js";
import { INVENTORY_ITEM_TYPE_LABELS } from "./inventoryItemTypeLabels.js";
import type { InventoryBalancesListQuery } from "./inventoryListQuery.js";
import { inventoryDec, inventoryDecOrNull } from "./inventorySerialization.server.js";

type BalanceFilterQuery = Omit<InventoryBalancesListQuery, "page" | "pageSize" | "skip">;

/** Filtro de saldos compartilhado entre a consulta (Estoque › Saldos) e o relatório. */
export function buildInventoryBalancesWhere(q: BalanceFilterQuery): Prisma.InventoryBalanceWhereInput {
  const itemWhere: Prisma.InventoryItemWhereInput = {
    ...(q.itemType ? { itemType: q.itemType } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.family ? { family: { contains: q.family, mode: "insensitive" } } : {}),
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
  if (q.family) filters.push({ label: "Família", value: q.family });
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
  q: BalanceFilterQuery,
  generatedAt = new Date()
): Promise<InventoryBalanceReport> {
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

  const itemIds = [...new Set(filtered.map((row) => row.item.id))];
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
    lines: filtered.map((row) => ({
      itemId: row.item.id,
      code: row.item.code,
      description: row.item.description,
      unit: row.item.unit,
      itemType: row.item.itemType,
      physicalQuantity: inventoryDec(row.physicalQuantity),
      lastMovementAt: row.lastMovementAt,
    })),
    lastCountAtByItemId,
    filters: await describeFilters(db, q),
    generatedAt,
  });
}

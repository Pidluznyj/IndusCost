/**
 * Persistência idempotente do cabeçalho de Ordens de Produção Nomus + vínculos oficiais (OP-05/OP-06).
 * Identidade da OP: `externalId`. Sem soft-delete por ausência no lote.
 * Vínculos: itensPedido via `syncNomusProductionOrderSalesLinks` (não altera SalesOrder/Item).
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import type { MappedNomusProductionOrder } from "@/src/lib/nomusProductionOrdersMapper.js";
import {
  syncNomusProductionOrderSalesLinks,
  type SyncNomusProductionOrderSalesLinksResult,
} from "@/src/lib/nomusProductionOrdersSalesLinks.server.js";

type DbClient = Prisma.TransactionClient | PrismaClient;

export type UpsertNomusProductionOrderHeaderAction = "create" | "update" | "unchanged";

export type UpsertNomusProductionOrderHeaderResult = {
  action: UpsertNomusProductionOrderHeaderAction;
  productionOrderId: string;
  payloadUnchanged: boolean;
};

export type UpsertNomusProductionOrderResult = UpsertNomusProductionOrderHeaderResult &
  SyncNomusProductionOrderSalesLinksResult;

function buildHeaderWriteData(
  row: MappedNomusProductionOrder,
  syncedAt: Date
): Omit<
  Prisma.NomusProductionOrderCreateInput,
  "externalId" | "firstSeenAt" | "lastChangedAt"
> {
  return {
    name: row.name,
    status: row.status,
    tipo: row.tipo,
    priority: row.priority,
    externalProductId: row.externalProductId,
    productCode: row.productCode,
    productDescription: row.productDescription,
    productAdditionalInfo: row.productAdditionalInfo,
    productConfigId: row.productConfigId,
    productConfigCode: row.productConfigCode,
    externalCompanyId: row.externalCompanyId,
    companyName: row.companyName,
    quantity: row.quantity,
    unit: row.unit,
    stockSector: row.stockSector,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    plannedAt: row.plannedAt,
    nomusUpdatedAt: row.nomusUpdatedAt,
    rawJson: row.rawJson as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
    lastSeenAt: syncedAt,
  };
}

/**
 * Upsert idempotente somente do registro principal da OP.
 * - Hash igual → atualiza apenas `syncedAt` / `lastSeenAt` (sem reescrever payload).
 * - Hash diferente → atualiza campos + `rawJson` + `lastChangedAt`.
 * - Não apaga OP ausente do lote.
 */
export async function upsertNomusProductionOrderHeader(
  db: DbClient,
  row: MappedNomusProductionOrder,
  syncedAt: Date
): Promise<UpsertNomusProductionOrderHeaderResult> {
  const existing = await db.nomusProductionOrder.findUnique({
    where: { externalId: row.externalId },
    select: { id: true, payloadHash: true },
  });

  if (existing == null) {
    const created = await db.nomusProductionOrder.create({
      data: {
        externalId: row.externalId,
        firstSeenAt: syncedAt,
        lastChangedAt: syncedAt,
        ...buildHeaderWriteData(row, syncedAt),
      },
      select: { id: true },
    });
    return {
      action: "create",
      productionOrderId: created.id,
      payloadUnchanged: false,
    };
  }

  if (existing.payloadHash === row.payloadHash) {
    await db.nomusProductionOrder.update({
      where: { externalId: row.externalId },
      data: {
        syncedAt,
        lastSeenAt: syncedAt,
      },
      select: { id: true },
    });
    return {
      action: "unchanged",
      productionOrderId: existing.id,
      payloadUnchanged: true,
    };
  }

  const updated = await db.nomusProductionOrder.update({
    where: { externalId: row.externalId },
    data: {
      ...buildHeaderWriteData(row, syncedAt),
      lastChangedAt: syncedAt,
    },
    select: { id: true },
  });

  return {
    action: "update",
    productionOrderId: updated.id,
    payloadUnchanged: false,
  };
}

/**
 * Cabeçalho + vínculos oficiais itensPedido (OP-06).
 * Sempre reconcilia links (mesmo com hash inalterado) para permitir resolução local posterior.
 */
export async function upsertNomusProductionOrder(
  db: DbClient,
  row: MappedNomusProductionOrder,
  syncedAt: Date
): Promise<UpsertNomusProductionOrderResult> {
  const header = await upsertNomusProductionOrderHeader(db, row, syncedAt);
  const links = await syncNomusProductionOrderSalesLinks(db, {
    productionOrderId: header.productionOrderId,
    productionOrderExternalId: row.externalId,
    salesLinks: row.salesLinks,
    syncedAt,
  });
  return {
    ...header,
    ...links,
  };
}

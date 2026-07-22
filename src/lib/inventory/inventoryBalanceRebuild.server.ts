/**
 * Reconstrução transacional de saldos a partir do ledger (OP-10).
 * Projeção materializada é verificável e reconstruível — nunca preenchida à mão.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertMaterializedMatchesLedger,
  projectBalancesFromLedger,
  type InventoryLedgerMovementFact,
} from "./inventoryLedgerProjection.js";
import {
  decimalQuantity,
  mapBalanceRowToSnapshot,
  persistInventoryBalanceSnapshot,
  type InventoryTx,
} from "./inventoryRepository.server.js";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import {
  buildInventoryBalanceKey,
  InventoryValidationError,
  roundInventoryQuantity,
  type InventoryBalanceSnapshot,
  type InventoryMovementType,
} from "./inventoryTypes.js";

export type RebuildInventoryBalancesInput = {
  itemId?: string | null;
  warehouseId?: string | null;
  /** Se true, só verifica divergências sem persistir. */
  dryRun?: boolean;
  reason?: string | null;
};

export type RebuildInventoryBalancesMismatch = {
  itemId: string;
  balanceKey: string;
  field: string;
  materialized: number;
  projected: number;
};

export type RebuildInventoryBalancesResult = {
  dryRun: boolean;
  scopesChecked: number;
  mismatches: RebuildInventoryBalancesMismatch[];
  balancesUpdated: number;
  snapshotId: string | null;
};

function toLedgerFact(row: {
  id: string;
  movementType: string;
  quantity: unknown;
  unit: string;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  reversedMovementId: string | null;
  movementDate: Date;
  createdByUserId: string | null;
  reversedMovement?: { movementType: string } | null;
}): InventoryLedgerMovementFact {
  const movementType = row.movementType as InventoryMovementType;
  const isEntry =
    movementType === "MANUAL_ENTRY" ||
    movementType === "PURCHASE_ENTRY" ||
    movementType === "PURCHASE_RECEIPT" ||
    movementType === "PRODUCTION_ENTRY" ||
    movementType === "RETURN" ||
    movementType === "POSITIVE_ADJUSTMENT" ||
    movementType === "INITIAL_BALANCE";

  const warehouseId = isEntry
    ? (row.destinationWarehouseId ?? row.sourceWarehouseId)
    : (row.sourceWarehouseId ?? row.destinationWarehouseId);
  if (!warehouseId) {
    throw new InventoryValidationError(
      `Movimento ${row.id} sem almoxarifado de escopo.`,
      "LEDGER_SCOPE_MISSING"
    );
  }

  const locationId = isEntry
    ? (row.destinationLocationId ?? row.sourceLocationId)
    : (row.sourceLocationId ?? row.destinationLocationId);

  return {
    id: row.id,
    movementType,
    quantity: Number(row.quantity),
    warehouseId,
    locationId,
    destinationWarehouseId: row.destinationWarehouseId,
    destinationLocationId: row.destinationLocationId,
    originalMovementType: (row.reversedMovement?.movementType as InventoryMovementType) ?? null,
    reversedMovementId: row.reversedMovementId,
    unit: row.unit,
    createdByUserId: row.createdByUserId,
    movementDate: row.movementDate.toISOString(),
  };
}

async function loadMovementsForRebuild(
  tx: InventoryTx,
  input: RebuildInventoryBalancesInput
) {
  return tx.inventoryMovement.findMany({
    where: {
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.warehouseId
        ? {
            OR: [
              { sourceWarehouseId: input.warehouseId },
              { destinationWarehouseId: input.warehouseId },
            ],
          }
        : {}),
    },
    include: {
      reversedMovement: { select: { movementType: true } },
    },
    orderBy: [{ movementDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Reconstrói (ou verifica) saldos materializados a partir do ledger.
 * Cria InventoryStockSnapshot quando persiste.
 */
export async function rebuildInventoryBalancesFromLedger(
  prisma: PrismaClient,
  input: RebuildInventoryBalancesInput,
  context: { userId: string; userName?: string | null }
): Promise<RebuildInventoryBalancesResult> {
  const dryRun = input.dryRun === true;

  return prisma.$transaction(async (tx) => {
    const movements = await loadMovementsForRebuild(tx, input);
    const byItem = new Map<string, typeof movements>();
    for (const mov of movements) {
      const list = byItem.get(mov.itemId) ?? [];
      list.push(mov);
      byItem.set(mov.itemId, list);
    }

    const mismatches: RebuildInventoryBalancesMismatch[] = [];
    let scopesChecked = 0;
    let balancesUpdated = 0;
    const projectedRows: Array<{
      itemId: string;
      warehouseId: string;
      locationId: string | null;
      balanceKey: string;
      snapshot: InventoryBalanceSnapshot;
      lastMovementId: string | null;
      unit: string;
      materialId: string | null;
      materialCodeSnapshot: string | null;
    }> = [];

    for (const [itemId, itemMovements] of byItem) {
      const facts = itemMovements.map(toLedgerFact);
      const projected = projectBalancesFromLedger(facts);

      const existingBalances = await tx.inventoryBalance.findMany({
        where: {
          itemId,
          ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
        },
      });

      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: {
          unit: true,
          materialId: true,
          materialCodeSnapshot: true,
        },
      });
      if (!item) continue;

      const existingByKey = new Map(existingBalances.map((b) => [b.balanceKey, b]));

      for (const [balanceKey, projectedBalance] of projected) {
        if (input.warehouseId && projectedBalance.warehouseId !== input.warehouseId) continue;
        scopesChecked += 1;
        const materialized = existingByKey.get(balanceKey);
        if (materialized) {
          try {
            assertMaterializedMatchesLedger(
              mapBalanceRowToSnapshot(materialized),
              projectedBalance
            );
          } catch {
            const fields: (keyof InventoryBalanceSnapshot)[] = [
              "physicalQuantity",
              "reservedQuantity",
              "blockedQuantity",
              "quarantineQuantity",
              "availableQuantity",
            ];
            const matSnap = mapBalanceRowToSnapshot(materialized);
            for (const field of fields) {
              if (
                roundInventoryQuantity(matSnap[field]) !==
                roundInventoryQuantity(projectedBalance[field])
              ) {
                mismatches.push({
                  itemId,
                  balanceKey,
                  field,
                  materialized: matSnap[field],
                  projected: projectedBalance[field],
                });
              }
            }
            if (!dryRun) {
              await persistInventoryBalanceSnapshot(
                tx,
                materialized.id,
                projectedBalance,
                new Date(),
                projectedBalance.lastMovementId
              );
              balancesUpdated += 1;
            }
          }
        } else if (!dryRun) {
          const created = await tx.inventoryBalance.create({
            data: {
              itemId,
              warehouseId: projectedBalance.warehouseId,
              locationId: projectedBalance.locationId,
              balanceKey,
              physicalQuantity: decimalQuantity(projectedBalance.physicalQuantity),
              reservedQuantity: decimalQuantity(projectedBalance.reservedQuantity),
              blockedQuantity: decimalQuantity(projectedBalance.blockedQuantity),
              quarantineQuantity: decimalQuantity(projectedBalance.quarantineQuantity),
              availableQuantity: decimalQuantity(projectedBalance.availableQuantity),
              lastMovementAt: new Date(),
              lastMovementId: projectedBalance.lastMovementId,
            },
          });
          balancesUpdated += 1;
          existingByKey.set(balanceKey, created);
        } else {
          mismatches.push({
            itemId,
            balanceKey,
            field: "missing",
            materialized: 0,
            projected: projectedBalance.physicalQuantity,
          });
        }

        projectedRows.push({
          itemId,
          warehouseId: projectedBalance.warehouseId,
          locationId: projectedBalance.locationId,
          balanceKey,
          snapshot: projectedBalance,
          lastMovementId: projectedBalance.lastMovementId,
          unit: item.unit,
          materialId: item.materialId,
          materialCodeSnapshot: item.materialCodeSnapshot,
        });
      }

      // Escopos materializados sem fatos → zerar se persistindo.
      for (const bal of existingBalances) {
        if (projected.has(bal.balanceKey)) continue;
        scopesChecked += 1;
        const snap = mapBalanceRowToSnapshot(bal);
        const empty = {
          physicalQuantity: 0,
          reservedQuantity: 0,
          blockedQuantity: 0,
          quarantineQuantity: 0,
          availableQuantity: 0,
        };
        try {
          assertMaterializedMatchesLedger(snap, empty);
        } catch {
          for (const field of Object.keys(empty) as (keyof typeof empty)[]) {
            if (roundInventoryQuantity(snap[field]) !== 0) {
              mismatches.push({
                itemId,
                balanceKey: bal.balanceKey,
                field,
                materialized: snap[field],
                projected: 0,
              });
            }
          }
          if (!dryRun) {
            await persistInventoryBalanceSnapshot(tx, bal.id, empty, bal.lastMovementAt ?? new Date(), bal.lastMovementId);
            balancesUpdated += 1;
          }
        }
      }
    }

    let snapshotId: string | null = null;
    if (!dryRun && projectedRows.length > 0) {
      const snapshot = await tx.inventoryStockSnapshot.create({
        data: {
          asOfAt: new Date(),
          source: "RECALCULATION",
          reason: input.reason?.trim() || "Reconstrução a partir do ledger",
          createdByUserId: context.userId,
          createdByUserName: context.userName ?? null,
          lines: {
            create: projectedRows.map((row) => ({
              itemId: row.itemId,
              warehouseId: row.warehouseId,
              locationId: row.locationId,
              balanceKey: row.balanceKey,
              physicalQuantity: decimalQuantity(row.snapshot.physicalQuantity),
              reservedQuantity: decimalQuantity(row.snapshot.reservedQuantity),
              blockedQuantity: decimalQuantity(row.snapshot.blockedQuantity),
              quarantineQuantity: decimalQuantity(row.snapshot.quarantineQuantity),
              availableQuantity: decimalQuantity(row.snapshot.availableQuantity),
              unit: row.unit,
              materialId: row.materialId,
              materialCodeSnapshot: row.materialCodeSnapshot,
              lastMovementId: row.lastMovementId,
            })),
          },
        },
      });
      snapshotId = snapshot.id;
    }

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryBalance",
      entityId: input.itemId ?? input.warehouseId ?? "ALL",
      action: dryRun ? "BALANCE_REBUILD_DRY_RUN" : "BALANCE_REBUILD",
      userId: context.userId,
      userName: context.userName ?? null,
      reason: input.reason ?? null,
      afterJson: {
        scopesChecked,
        mismatches: mismatches.length,
        balancesUpdated,
        snapshotId,
      },
    });

    return {
      dryRun,
      scopesChecked,
      mismatches,
      balancesUpdated,
      snapshotId,
    };
  });
}

export { buildInventoryBalanceKey };

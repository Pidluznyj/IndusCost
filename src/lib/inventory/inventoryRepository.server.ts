/**
 * Repositório de saldo — server-only.
 * Única camada autorizada a persistir InventoryBalance (via serviço de movimentação).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildInventoryBalanceKey,
  emptyInventoryBalance,
  snapshotFromBalance,
  type InventoryBalanceSnapshot,
} from "./inventoryTypes.js";

export type InventoryBalanceRow = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  balanceKey: string;
  physicalQuantity: unknown;
  reservedQuantity: unknown;
  blockedQuantity: unknown;
  quarantineQuantity: unknown;
  availableQuantity: unknown;
};

export type InventoryTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export function mapBalanceRowToSnapshot(row: InventoryBalanceRow): InventoryBalanceSnapshot {
  return snapshotFromBalance({
    physicalQuantity: Number(row.physicalQuantity),
    reservedQuantity: Number(row.reservedQuantity),
    blockedQuantity: Number(row.blockedQuantity),
    quarantineQuantity: Number(row.quarantineQuantity),
    availableQuantity: Number(row.availableQuantity),
  });
}

export async function findInventoryBalanceForUpdate(
  tx: InventoryTx,
  itemId: string,
  warehouseId: string,
  locationId?: string | null
): Promise<(InventoryBalanceRow & InventoryBalanceSnapshot) | null> {
  const balanceKey = buildInventoryBalanceKey(warehouseId, locationId);
  const row = await tx.inventoryBalance.findUnique({
    where: { itemId_balanceKey: { itemId, balanceKey } },
  });
  if (!row) return null;
  return { ...row, ...mapBalanceRowToSnapshot(row) };
}

export async function getOrCreateInventoryBalanceForUpdate(
  tx: InventoryTx,
  itemId: string,
  warehouseId: string,
  locationId?: string | null
): Promise<InventoryBalanceRow & InventoryBalanceSnapshot> {
  const balanceKey = buildInventoryBalanceKey(warehouseId, locationId);
  const existing = await tx.inventoryBalance.findUnique({
    where: { itemId_balanceKey: { itemId, balanceKey } },
  });
  if (existing) {
    return { ...existing, ...mapBalanceRowToSnapshot(existing) };
  }

  const empty = emptyInventoryBalance();
  const created = await tx.inventoryBalance.create({
    data: {
      itemId,
      warehouseId,
      locationId: locationId ?? null,
      balanceKey,
      physicalQuantity: empty.physicalQuantity,
      reservedQuantity: empty.reservedQuantity,
      blockedQuantity: empty.blockedQuantity,
      quarantineQuantity: empty.quarantineQuantity,
      availableQuantity: empty.availableQuantity,
    },
  });
  return { ...created, ...mapBalanceRowToSnapshot(created) };
}

export async function persistInventoryBalanceSnapshot(
  tx: InventoryTx,
  balanceId: string,
  snapshot: InventoryBalanceSnapshot,
  movementDate: Date
): Promise<void> {
  await tx.inventoryBalance.update({
    where: { id: balanceId },
    data: {
      physicalQuantity: snapshot.physicalQuantity,
      reservedQuantity: snapshot.reservedQuantity,
      blockedQuantity: snapshot.blockedQuantity,
      quarantineQuantity: snapshot.quarantineQuantity,
      availableQuantity: snapshot.availableQuantity,
      lastMovementAt: movementDate,
    },
  });
}

export function decimalQuantity(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Repositório de saldo — server-only.
 * Única camada autorizada a persistir InventoryBalance (via serviço de movimentação).
 * Locks FOR UPDATE para concorrência do ledger (OP-09).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  inventoryBalanceLockKey,
  orderBalanceLockTargets,
  type InventoryBalanceLockTarget,
} from "./inventoryLedgerConcurrency.js";
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

async function lockBalanceById(tx: InventoryTx, balanceId: string): Promise<void> {
  // Em testes sem $queryRaw, o lock é no-op; em produção usa FOR UPDATE.
  if (typeof tx.$queryRaw !== "function") return;
  await tx.$queryRaw`SELECT 1 FROM "InventoryBalance" WHERE id = ${balanceId}::uuid FOR UPDATE`;
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
  await lockBalanceById(tx, row.id);
  const locked = await tx.inventoryBalance.findUnique({ where: { id: row.id } });
  if (!locked) return null;
  return { ...locked, ...mapBalanceRowToSnapshot(locked) };
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
    await lockBalanceById(tx, existing.id);
    const locked = await tx.inventoryBalance.findUnique({ where: { id: existing.id } });
    if (!locked) {
      throw new Error(`Saldo sumiu após lock: ${existing.id}`);
    }
    return { ...locked, ...mapBalanceRowToSnapshot(locked) };
  }

  const empty = emptyInventoryBalance();
  try {
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
    await lockBalanceById(tx, created.id);
    return { ...created, ...mapBalanceRowToSnapshot(created) };
  } catch (e: unknown) {
    // Corrida de criação: outro tx inseriu — relê e trava.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const raced = await findInventoryBalanceForUpdate(tx, itemId, warehouseId, locationId);
      if (raced) return raced;
    }
    throw e;
  }
}

/** Adquire locks em ordem estável (anti-deadlock em transferência). */
export async function getOrCreateBalancesForUpdateOrdered(
  tx: InventoryTx,
  targets: readonly InventoryBalanceLockTarget[]
): Promise<Map<string, InventoryBalanceRow & InventoryBalanceSnapshot>> {
  const ordered = orderBalanceLockTargets(targets);
  const result = new Map<string, InventoryBalanceRow & InventoryBalanceSnapshot>();
  for (const target of ordered) {
    const row = await getOrCreateInventoryBalanceForUpdate(
      tx,
      target.itemId,
      target.warehouseId,
      target.locationId
    );
    result.set(inventoryBalanceLockKey(target), row);
  }
  return result;
}

export async function persistInventoryBalanceSnapshot(
  tx: InventoryTx,
  balanceId: string,
  snapshot: InventoryBalanceSnapshot,
  movementDate: Date,
  lastMovementId?: string | null
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
      ...(lastMovementId !== undefined ? { lastMovementId } : {}),
    },
  });
}

export function decimalQuantity(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export function decimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value == null) return null;
  return new Prisma.Decimal(value);
}

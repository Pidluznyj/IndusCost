#!/usr/bin/env npx tsx
/**
 * Regularização de `InventoryItem.defaultWarehouseId` — itens ativos que
 * controlam estoque e ficaram sem almoxarifado padrão (não entravam na
 * conferência do tablet do setor STANDARD, ex.: ADMINISTRATIVO).
 *
 * Dry-run (padrão, 100% leitura; grava só o relatório JSON):
 *   npm run inventory:default-warehouse-regularization:dry
 *   npm run inventory:default-warehouse-regularization:dry -- --itemType=ADMINISTRATIVE_SUPPLY --codes=ADM-INF-037,ADM-INF-038
 *
 * Apply (transação única; CAS por item; auditoria por item):
 *   npm run inventory:default-warehouse-regularization:apply -- --actorUserId=<UUID> --confirm=REGULARIZE_INVENTORY_ITEM_DEFAULT_WAREHOUSE [--itemType=...] [--codes=...]
 *
 * Revert (desfaz um apply a partir do relatório dele; só o que ainda está como foi gravado):
 *   npx tsx scripts/regularizeInventoryItemDefaultWarehouse.ts --revert --report=<apply.json> --actorUserId=<UUID> --confirm=REGULARIZE_INVENTORY_ITEM_DEFAULT_WAREHOUSE
 *
 * Nunca cria/altera InventoryBalance, InventoryMovement, InventoryCountSession
 * ou InventoryCountLine. Não toca Material, Product nem sincronização Nomus.
 * O alvo vem dos setores STANDARD ativos (InventoryStockSector), não de código fixo.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { INVENTORY_ITEM_TYPES, type InventoryItemType } from "../src/lib/inventory/inventoryTypes.ts";
import {
  DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM,
  assertRegularizationApplyRequest,
  executeDefaultWarehouseRegularization,
  formatRegularizationPlanReport,
  planDefaultWarehouseRegularization,
  revertDefaultWarehouseRegularization,
  type RegularizationApplyResult,
  type RegularizationItemSnapshot,
  type RegularizationSectorSnapshot,
  type RegularizationWarehouseSnapshot,
} from "../src/lib/inventory/inventoryItemDefaultWarehouseRegularization.ts";

type Db = PrismaClient | Prisma.TransactionClient;

function argumentValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((token) => token.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")) return argv[index + 1];
  return null;
}

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function parseItemTypes(raw: string | null): InventoryItemType[] | null {
  if (!raw) return null;
  const types = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  for (const t of types) {
    if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(t)) {
      throw new Error(`--itemType inválido: ${t}`);
    }
  }
  return types as InventoryItemType[];
}

function parseCodes(raw: string | null): string[] | null {
  if (!raw) return null;
  const codes = raw.split(",").map((c) => c.trim()).filter(Boolean);
  return codes.length ? codes : null;
}

/** Snapshot completo (leitura) — 4 consultas, independentemente do número de itens. */
async function loadSnapshot(db: Db) {
  const [items, sectors, warehouses] = await Promise.all([
    db.inventoryItem.findMany({
      where: { status: "ACTIVE", controlsStock: true, defaultWarehouseId: null },
      select: {
        id: true,
        code: true,
        description: true,
        itemType: true,
        status: true,
        controlsStock: true,
        materialId: true,
        productId: true,
        defaultWarehouseId: true,
        defaultLocationId: true,
        createdAt: true,
        balances: { select: { warehouseId: true } },
        reservations: { where: { status: "ACTIVE" }, select: { warehouseId: true } },
        blocks: { where: { status: "ACTIVE" }, select: { warehouseId: true } },
      },
      orderBy: { code: "asc" },
    }),
    db.inventoryStockSector.findMany({
      where: { status: "ACTIVE", strategy: "STANDARD", itemType: { not: null } },
      select: {
        id: true,
        code: true,
        name: true,
        itemType: true,
        warehouseId: true,
        warehouse: { select: { code: true, name: true } },
      },
      orderBy: { code: "asc" },
    }),
    db.inventoryWarehouse.findMany({
      select: { id: true, code: true, status: true, allowsMovements: true },
    }),
  ]);

  const itemSnapshots: RegularizationItemSnapshot[] = items.map((item) => ({
    id: item.id,
    code: item.code,
    description: item.description,
    itemType: item.itemType as InventoryItemType,
    status: item.status,
    controlsStock: item.controlsStock,
    materialId: item.materialId,
    productId: item.productId,
    defaultWarehouseId: item.defaultWarehouseId,
    defaultLocationId: item.defaultLocationId,
    createdAt: item.createdAt?.toISOString() ?? null,
    balanceWarehouseIds: [...new Set(item.balances.map((b) => b.warehouseId))],
    activeReservationWarehouseIds: [...new Set(item.reservations.map((r) => r.warehouseId))],
    activeBlockWarehouseIds: [...new Set(item.blocks.map((b) => b.warehouseId))],
  }));
  const sectorSnapshots: RegularizationSectorSnapshot[] = sectors.map((s) => ({
    sectorId: s.id,
    sectorCode: s.code,
    sectorName: s.name,
    itemType: s.itemType as InventoryItemType,
    warehouseId: s.warehouseId,
    warehouseCode: s.warehouse.code,
    warehouseName: s.warehouse.name,
  }));
  const warehousesById = new Map<string, RegularizationWarehouseSnapshot>(
    warehouses.map((w) => [w.id, { id: w.id, code: w.code, status: w.status, allowsMovements: w.allowsMovements }])
  );
  return { items: itemSnapshots, sectors: sectorSnapshots, warehousesById };
}

function reportsDir(): string {
  const dir = path.join(process.cwd(), "reports", "inventory-default-warehouse-regularization");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function loadActor(prisma: PrismaClient, actorUserId: string) {
  const row = await prisma.appUser.findUnique({
    where: { id: actorUserId.trim() },
    select: { id: true, name: true, isActive: true },
  });
  if (!row) throw new Error("actorUserId não encontrado. Nada foi gravado.");
  return { id: row.id, name: row.name ?? null, isActive: row.isActive };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const apply = hasFlag(argv, "apply");
  const revert = hasFlag(argv, "revert");
  const filters = { itemTypes: parseItemTypes(argumentValue(argv, "itemType")), codes: parseCodes(argumentValue(argv, "codes")) };
  const prisma = new PrismaClient();

  try {
    if (revert) {
      const reportPath = argumentValue(argv, "report");
      if (!reportPath) throw new Error("--revert exige --report=<apply.json>.");
      assertRegularizationApplyRequest({
        confirm: argumentValue(argv, "confirm"),
        actorUserId: argumentValue(argv, "actorUserId"),
      });
      const applyResult = JSON.parse(readFileSync(reportPath, "utf8")) as RegularizationApplyResult;
      const actor = await loadActor(prisma, argumentValue(argv, "actorUserId") as string);
      const result = await prisma.$transaction(async (tx) =>
        revertDefaultWarehouseRegularization({
          applyResult,
          actor,
          tx: {
            clearDefaultWarehouseIfEquals: async (itemId, warehouseId) => {
              const r = await tx.inventoryItem.updateMany({
                where: { id: itemId, defaultWarehouseId: warehouseId },
                data: { defaultWarehouseId: null, updatedByUserId: actor.id },
              });
              return r.count === 1;
            },
            writeAudit: async (a) => {
              await tx.inventoryAuditLog.create({
                data: {
                  entityType: "InventoryItem",
                  entityId: a.entityId,
                  action: a.action,
                  beforeJson: a.beforeJson as Prisma.InputJsonValue,
                  afterJson: a.afterJson as Prisma.InputJsonValue,
                  userId: a.userId,
                  userName: a.userName,
                  reason: a.reason,
                },
              });
            },
          },
        })
      );
      const out = path.join(reportsDir(), `revert-${stamp()}.json`);
      writeFileSync(out, JSON.stringify(result, null, 2));
      console.log(`Revert: ${result.reverted} revertido(s), ${result.skippedChanged} já alterado(s) depois (não tocados). Relatório: ${out}`);
      return;
    }

    // Dry-run sempre primeiro — inclusive dentro do apply (plano recalculado na transação).
    const snapshot = await loadSnapshot(prisma);
    const plan = planDefaultWarehouseRegularization({
      items: snapshot.items,
      activeStandardSectors: snapshot.sectors,
      warehousesById: snapshot.warehousesById,
      filters,
    });
    console.log(formatRegularizationPlanReport(plan));
    const dryOut = path.join(reportsDir(), `dry-run-${stamp()}.json`);
    writeFileSync(dryOut, JSON.stringify(plan, null, 2));
    console.log(`Relatório da prévia: ${dryOut}`);

    if (!apply) {
      console.log(`Modo dry-run. Nada foi gravado. Apply: --apply --actorUserId=<UUID> --confirm=${DEFAULT_WAREHOUSE_REGULARIZATION_CONFIRM}`);
      return;
    }

    assertRegularizationApplyRequest({
      confirm: argumentValue(argv, "confirm"),
      actorUserId: argumentValue(argv, "actorUserId"),
    });
    const actor = await loadActor(prisma, argumentValue(argv, "actorUserId") as string);

    const result = await prisma.$transaction(
      async (tx) => {
        // Reavalia dentro da transação: o que mudou desde a prévia não é tocado.
        const fresh = await loadSnapshot(tx);
        const freshPlan = planDefaultWarehouseRegularization({
          items: fresh.items,
          activeStandardSectors: fresh.sectors,
          warehousesById: fresh.warehousesById,
          filters,
        });
        return executeDefaultWarehouseRegularization({
          plan: freshPlan,
          actor,
          tx: {
            setDefaultWarehouseIfUnset: async (itemId, warehouseId) => {
              const r = await tx.inventoryItem.updateMany({
                where: { id: itemId, defaultWarehouseId: null, status: "ACTIVE", controlsStock: true },
                data: { defaultWarehouseId: warehouseId, updatedByUserId: actor.id },
              });
              return r.count === 1;
            },
            writeAudit: async (a) => {
              await tx.inventoryAuditLog.create({
                data: {
                  entityType: "InventoryItem",
                  entityId: a.entityId,
                  action: a.action,
                  beforeJson: a.beforeJson as Prisma.InputJsonValue,
                  afterJson: a.afterJson as Prisma.InputJsonValue,
                  userId: a.userId,
                  userName: a.userName,
                  reason: a.reason,
                },
              });
            },
          },
        });
      },
      { timeout: 60_000 }
    );
    const applyOut = path.join(reportsDir(), `apply-${stamp()}.json`);
    writeFileSync(applyOut, JSON.stringify(result, null, 2));
    console.log(
      `Apply: ${result.applied} gravado(s), ${result.skippedAlreadySet} já definido(s) (não tocados), ${result.notEligible} não elegível(is). Relatório (use no --revert): ${applyOut}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

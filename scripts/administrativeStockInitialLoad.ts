#!/usr/bin/env npx tsx
/**
 * Preview / apply / verify da carga inicial do Estoque Administrativo.
 *
 *   npm run inventory:administrative-initial-load:preview -- --file=/tmp/cadastro_inicial_estoque_administrativo.csv
 *   npm run inventory:administrative-initial-load:apply -- --file=/tmp/cadastro_inicial_estoque_administrativo.csv --actorUserId=<UUID> --confirm=ADMINISTRATIVE_STOCK_INITIAL_LOAD
 *   npm run inventory:administrative-initial-load:verify -- --file=/tmp/cadastro_inicial_estoque_administrativo.csv
 *
 * PREVIEW é 100% read-only. APPLY só grava cadastro (Warehouse + InventoryItem).
 * Não cria InventoryBalance, InventoryMovement nem saldo_inicial.
 * Não altera Product, Material, MP, COMPONENTES ou PA.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  ADMINISTRATIVE_STOCK_APPLY_CONFIRM,
  AdministrativeStockItemCodeTakenError,
  assertAdministrativeStockApplyRequest,
  executeAdministrativeStockApply,
  renderAdministrativeStockApplyCsv,
  type AdministrativeStockApplyActor,
  type AdministrativeStockApplyTx,
  type AdministrativeStockNewItemData,
  type AdministrativeStockWarehouseCreateData,
} from "../src/lib/inventory/administrativeStockInitialLoadApply.ts";
import {
  ADMINISTRATIVE_STOCK_DEFAULT_FILE,
  ADMINISTRATIVE_STOCK_WAREHOUSE_CODE,
  AdministrativeStockPreviewError,
  assertAdministrativeStockPreviewCommand,
  classifyAdministrativeStockPreview,
  formatAdministrativeStockPreviewReport,
  mapAdministrativeStockCsvRecords,
  parseAdministrativeStockCsvText,
  renderAdministrativeStockPreviewCsv,
  sha256Hex,
  type AdministrativeStockItemSnapshot,
  type AdministrativeStockWarehouseSnapshot,
} from "../src/lib/inventory/administrativeStockInitialLoadPreview.ts";
import {
  formatAdministrativeStockVerifyReport,
  renderAdministrativeStockVerifyCsv,
  verifyAdministrativeStockInitialLoad,
} from "../src/lib/inventory/administrativeStockInitialLoadVerify.ts";

type StockReader = PrismaClient | Prisma.TransactionClient;

function argumentValue(argv: readonly string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((token) => token.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  if (index >= 0) return argv[index + 1] ?? null;
  return null;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

function resolveFilePath(argv: readonly string[]): string {
  return path.resolve(argumentValue(argv, "file")?.trim() || ADMINISTRATIVE_STOCK_DEFAULT_FILE);
}

function readCsvBundle(filePath: string) {
  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    throw new AdministrativeStockPreviewError(
      `Arquivo não encontrado: ${filePath}. Nada foi gravado.`
    );
  }
  const text = buffer.toString("utf8");
  const parsed = parseAdministrativeStockCsvText(text);
  const mapped = mapAdministrativeStockCsvRecords(parsed.records);
  return {
    resolvedFile: filePath,
    sourceFileName: path.basename(filePath),
    sha256: sha256Hex(buffer),
    sourceRows: mapped.rows,
    invalidRows: mapped.invalid,
  };
}

async function loadWarehouse(prisma: StockReader): Promise<AdministrativeStockWarehouseSnapshot | null> {
  return prisma.inventoryWarehouse.findFirst({
    where: { code: { equals: ADMINISTRATIVE_STOCK_WAREHOUSE_CODE, mode: "insensitive" } },
    select: { id: true, code: true, name: true, status: true, allowsMovements: true },
  });
}

async function loadItems(
  prisma: StockReader,
  codes: readonly string[]
): Promise<AdministrativeStockItemSnapshot[]> {
  if (codes.length === 0) return [];
  const items: AdministrativeStockItemSnapshot[] = [];
  for (const chunk of chunks(codes, 200)) {
    const found = await prisma.inventoryItem.findMany({
      where: {
        OR: chunk.map((code) => ({ code: { equals: code, mode: "insensitive" } })),
      },
      select: {
        id: true,
        code: true,
        description: true,
        itemType: true,
        unit: true,
        status: true,
        controlsStock: true,
        defaultWarehouseId: true,
        defaultLocationId: true,
      },
    });
    items.push(...found);
  }
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function countBalancesByItemIds(
  prisma: StockReader,
  itemIds: readonly string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (itemIds.length === 0) return map;
  for (const chunk of chunks(itemIds, 500)) {
    const grouped = await prisma.inventoryBalance.groupBy({
      by: ["itemId"],
      where: { itemId: { in: [...chunk] } },
      _count: { _all: true },
    });
    for (const row of grouped) map.set(row.itemId, row._count._all);
  }
  return map;
}

async function countMovementsByItemIds(
  prisma: StockReader,
  itemIds: readonly string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (itemIds.length === 0) return map;
  for (const chunk of chunks(itemIds, 500)) {
    const grouped = await prisma.inventoryMovement.groupBy({
      by: ["itemId"],
      where: { itemId: { in: [...chunk] } },
      _count: { _all: true },
    });
    for (const row of grouped) map.set(row.itemId, row._count._all);
  }
  return map;
}

function applyTx(tx: Prisma.TransactionClient): AdministrativeStockApplyTx {
  return {
    ensureWarehouse: async (data: AdministrativeStockWarehouseCreateData) => {
      const existing = await tx.inventoryWarehouse.findFirst({
        where: { code: { equals: data.code, mode: "insensitive" } },
        select: { id: true, code: true, name: true, status: true, allowsMovements: true },
      });
      if (existing) return { warehouse: existing, created: false };
      const created = await tx.inventoryWarehouse.create({
        data: {
          code: data.code,
          name: data.name,
          status: data.status,
          allowsMovements: data.allowsMovements,
          createdByUserId: data.createdByUserId,
        },
        select: { id: true, code: true, name: true, status: true, allowsMovements: true },
      });
      return { warehouse: created, created: true };
    },
    findItemsByCodes: async (codes) => loadItems(tx, codes),
    createItem: async (data: AdministrativeStockNewItemData) => {
      try {
        return await tx.inventoryItem.create({
          data: {
            code: data.code,
            description: data.description,
            itemType: data.itemType,
            unit: data.unit,
            family: data.family,
            group: data.group,
            status: data.status,
            controlsStock: data.controlsStock,
            defaultWarehouseId: data.defaultWarehouseId,
            defaultLocationId: data.defaultLocationId,
            minimumStock: data.minimumStock,
            maximumStock: data.maximumStock,
            reorderPoint: data.reorderPoint,
            preferredSupplierName: data.preferredSupplierName,
            lastKnownCost: data.lastKnownCost,
            notes: data.notes,
            createdByUserId: data.createdByUserId,
          },
          select: { id: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new AdministrativeStockItemCodeTakenError();
        }
        throw error;
      }
    },
  };
}

async function buildPreview(argv: readonly string[], prisma: PrismaClient) {
  const filePath = resolveFilePath(argv);
  const csv = readCsvBundle(filePath);
  const codes = csv.sourceRows.map((row) => row.code);
  const [warehouse, items] = await Promise.all([loadWarehouse(prisma), loadItems(prisma, codes)]);
  return classifyAdministrativeStockPreview({
    sourceRows: csv.sourceRows,
    invalidRows: csv.invalidRows,
    items,
    warehouse,
    sha256: csv.sha256,
    sourceFileName: csv.sourceFileName,
  });
}

async function runPreview(argv: readonly string[]): Promise<void> {
  assertAdministrativeStockPreviewCommand(argv);
  if (!process.env.DATABASE_URL?.trim()) {
    throw new AdministrativeStockPreviewError("DATABASE_URL ausente. PREVIEW foi interrompido. Nada foi gravado.");
  }
  const prisma = new PrismaClient();
  try {
    const preview = await buildPreview(argv, prisma);
    const outDir = argumentValue(argv, "out")
      ? path.resolve(argumentValue(argv, "out") as string)
      : os.tmpdir();
    const csvPath = path.join(outDir, "administrative-stock-initial-preview.csv");
    const jsonPath = path.join(outDir, "administrative-stock-initial-preview.json");
    writeFileSync(csvPath, renderAdministrativeStockPreviewCsv(preview.rows), "utf8");
    writeFileSync(jsonPath, JSON.stringify(preview, null, 2), "utf8");
    console.log(formatAdministrativeStockPreviewReport(preview));
    console.log(`csv: ${csvPath}`);
    console.log(`json: ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function runApply(argv: readonly string[]): Promise<void> {
  const filePath = resolveFilePath(argv);
  const actorUserId = argumentValue(argv, "actorUserId");
  const confirm = argumentValue(argv, "confirm");
  assertAdministrativeStockApplyRequest({ confirm, actorUserId, filePath });
  if (!process.env.DATABASE_URL?.trim()) {
    throw new AdministrativeStockPreviewError("DATABASE_URL ausente. APPLY foi interrompido. Nada foi gravado.");
  }
  const prisma = new PrismaClient();
  try {
    const actorRow = await prisma.appUser.findUnique({
      where: { id: (actorUserId as string).trim() },
      select: { id: true, isActive: true, role: true },
    });
    if (!actorRow?.isActive) {
      throw new AdministrativeStockPreviewError(
        "Responsável inexistente ou inativo. APPLY foi interrompido. Nada foi gravado."
      );
    }
    const actor: AdministrativeStockApplyActor = {
      id: actorRow.id,
      role: actorRow.role,
      isActive: actorRow.isActive,
    };
    const preview = await buildPreview(argv, prisma);
    const result = await prisma.$transaction(async (tx) =>
      executeAdministrativeStockApply({
        preview,
        actor,
        tx: applyTx(tx),
      })
    );
    const outDir = argumentValue(argv, "out")
      ? path.resolve(argumentValue(argv, "out") as string)
      : os.tmpdir();
    const csvPath = path.join(outDir, "administrative-stock-initial-apply.csv");
    const jsonPath = path.join(outDir, "administrative-stock-initial-apply.json");
    writeFileSync(csvPath, renderAdministrativeStockApplyCsv(result.lines), "utf8");
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          sourceFileName: preview.sourceFileName,
          sha256: preview.sha256,
          confirm: ADMINISTRATIVE_STOCK_APPLY_CONFIRM,
          generatedAt: new Date().toISOString(),
          warehouseAction: result.warehouseAction,
          warehouseId: result.warehouseId,
          created: result.created,
          alreadyExistsMatch: result.alreadyExistsMatch,
          conflict: result.conflict,
          invalid: result.invalid,
          failed: result.failed,
          lines: result.lines,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log("=== ADMINISTRATIVE STOCK INITIAL LOAD APPLY ===");
    console.log(`arquivo: ${preview.sourceFileName}`);
    console.log(`sha256: ${preview.sha256}`);
    console.log(`warehouseAction: ${result.warehouseAction}`);
    console.log(`warehouseId: ${result.warehouseId}`);
    console.log(`created: ${result.created}`);
    console.log(`alreadyExistsMatch: ${result.alreadyExistsMatch}`);
    console.log(`conflict: ${result.conflict}`);
    console.log(`invalid: ${result.invalid}`);
    console.log(`failed: ${result.failed}`);
    console.log(`csv: ${csvPath}`);
    console.log(`json: ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function runVerify(argv: readonly string[]): Promise<void> {
  if (argv.some((token) => token === "apply" || token === "--apply" || token.startsWith("--apply="))) {
    throw new AdministrativeStockPreviewError("VERIFY não grava e não aceita apply. Nada foi gravado.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new AdministrativeStockPreviewError("DATABASE_URL ausente. VERIFY foi interrompido. Nada foi gravado.");
  }
  const prisma = new PrismaClient();
  try {
    const filePath = resolveFilePath(argv);
    const csv = readCsvBundle(filePath);
    const codes = csv.sourceRows.map((row) => row.code);
    const warehouse = await loadWarehouse(prisma);
    const items = await loadItems(prisma, codes);
    const itemIds = items.map((item) => item.id);
    const [balanceCountByItemId, movementCountByItemId] = await Promise.all([
      countBalancesByItemIds(prisma, itemIds),
      countMovementsByItemIds(prisma, itemIds),
    ]);
    const result = verifyAdministrativeStockInitialLoad({
      sourceRows: csv.sourceRows,
      warehouse,
      items,
      balanceCountByItemId,
      movementCountByItemId,
    });
    const outDir = argumentValue(argv, "out")
      ? path.resolve(argumentValue(argv, "out") as string)
      : os.tmpdir();
    const csvPath = path.join(outDir, "administrative-stock-initial-verify.csv");
    const jsonPath = path.join(outDir, "administrative-stock-initial-verify.json");
    writeFileSync(csvPath, renderAdministrativeStockVerifyCsv(result.findings), "utf8");
    writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");
    console.log(formatAdministrativeStockVerifyReport(result));
    console.log(`csv: ${csvPath}`);
    console.log(`json: ${jsonPath}`);
    if (result.status === "BLOQUEANTE") process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "preview";
  if (command === "preview") return runPreview(argv.slice(1));
  if (command === "apply") return runApply(argv.slice(1));
  if (command === "verify") return runVerify(argv.slice(1));
  throw new AdministrativeStockPreviewError(
    "Comando inválido. Use preview | apply | verify. Nada foi gravado."
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

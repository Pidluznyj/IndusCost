#!/usr/bin/env npx tsx
/**
 * Preview / dry-run da carga inicial de estoque a partir de
 * RelatorioPosicaoEstoqueEmpresa.
 *
 *   npx tsx scripts/nomusStockInitialLoad.ts preview --file=/caminho/arquivo.xls
 *   npm run inventory:nomus-initial-stock:preview -- --file=/caminho/arquivo.xls
 *   npm run inventory:nomus-initial-stock:verify -- --file=/caminho/arquivo.xls
 *
 * Preview / dry-run é o padrão. APPLY só grava com o comando apply,
 * --actorUserId e --confirm=NOMUS_INITIAL_STOCK_LOAD.
 * O saldo inicial passa exclusivamente por createInitialInventoryBalance().
 * Este script não escreve InventoryBalance, Product nem Material.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import {
  assertNomusStockApplyRequest,
  assertNomusStockFileStable,
  executeNomusStockApply,
  NomusStockItemCodeTakenError,
  renderNomusStockApplyCsv,
  resolveNomusStockAsOf,
  type NomusStockApplyActor,
  type NomusStockApplyTx,
  type NomusStockNewItemData,
} from "../src/lib/inventory/nomusStockInitialLoadApply.ts";
import { createInitialInventoryBalance } from "../src/lib/inventory/inventoryService.server.ts";
import {
  formatNomusStockVerifyReport,
  renderNomusStockVerifyCsv,
  verifyNomusStockInitialLoad,
} from "../src/lib/inventory/nomusStockInitialLoadVerify.ts";
import {
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE,
  NomusStockPreviewError,
  assertNomusStockPreviewCommand,
  classifyNomusStockPreview,
  formatNomusStockPreviewReport,
  locateNomusStockHeaders,
  readNomusStockRows,
  renderNomusStockPreviewCsv,
  type NomusStockBalanceSnapshot,
  type NomusStockItemSnapshot,
  type NomusStockMovementSnapshot,
  type NomusStockProductSnapshot,
  type NomusStockWarehouseSnapshot,
} from "../src/lib/inventory/nomusStockInitialLoadPreview.ts";

const DESTINATION_WAREHOUSE_CODES = [
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT,
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.COMPONENT,
];

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

function asNumber(value: { toString(): string } | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadProducts(prisma: StockReader, skus: readonly string[]): Promise<NomusStockProductSnapshot[]> {
  const products: NomusStockProductSnapshot[] = [];
  for (const chunk of chunks(skus, 200)) {
    const found = await prisma.product.findMany({
      where: { OR: chunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" } })) },
      select: { id: true, sku: true, name: true, type: true, status: true, sourceExternalId: true },
    });
    products.push(...found);
  }
  return [...new Map(products.map((product) => [product.id, product])).values()];
}

async function loadItems(
  prisma: StockReader,
  skus: readonly string[],
  productIds: readonly string[]
): Promise<NomusStockItemSnapshot[]> {
  const items: NomusStockItemSnapshot[] = [];
  for (const chunk of chunks(productIds, 500)) {
    if (chunk.length === 0) continue;
    const found = await prisma.inventoryItem.findMany({
      where: { productId: { in: [...chunk] } },
      select: {
        id: true,
        code: true,
        productId: true,
        materialId: true,
        itemType: true,
        unit: true,
        nomusProductCode: true,
      },
    });
    items.push(...found);
  }
  for (const chunk of chunks(skus, 150)) {
    const found = await prisma.inventoryItem.findMany({
      where: {
        OR: chunk.flatMap((sku) => [
          { code: { equals: sku, mode: "insensitive" } },
          { nomusProductCode: { equals: sku, mode: "insensitive" } },
        ]),
      },
      select: {
        id: true,
        code: true,
        productId: true,
        materialId: true,
        itemType: true,
        unit: true,
        nomusProductCode: true,
      },
    });
    items.push(...found);
  }
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

async function loadWarehouses(prisma: StockReader): Promise<NomusStockWarehouseSnapshot[]> {
  return prisma.inventoryWarehouse.findMany({
    where: {
      OR: DESTINATION_WAREHOUSE_CODES.map((code) => ({ code: { equals: code, mode: "insensitive" } })),
    },
    select: { id: true, code: true, status: true, allowsMovements: true },
  });
}

async function loadBalances(
  prisma: StockReader,
  itemIds: readonly string[],
  warehouseIds: readonly string[] | null
): Promise<NomusStockBalanceSnapshot[]> {
  if (itemIds.length === 0) return [];
  if (warehouseIds && warehouseIds.length === 0) return [];
  const balances: NomusStockBalanceSnapshot[] = [];
  for (const chunk of chunks(itemIds, 500)) {
    const found = await prisma.inventoryBalance.findMany({
      where: {
        itemId: { in: [...chunk] },
        ...(warehouseIds ? { warehouseId: { in: [...warehouseIds] } } : {}),
      },
      select: {
        itemId: true,
        warehouseId: true,
        locationId: true,
        physicalQuantity: true,
        availableQuantity: true,
        reservedQuantity: true,
        blockedQuantity: true,
        quarantineQuantity: true,
      },
    });
    balances.push(
      ...found.map((balance) => ({
        itemId: balance.itemId,
        warehouseId: balance.warehouseId,
        locationId: balance.locationId,
        physicalQuantity: asNumber(balance.physicalQuantity),
        availableQuantity: asNumber(balance.availableQuantity),
        reservedQuantity: asNumber(balance.reservedQuantity),
        blockedQuantity: asNumber(balance.blockedQuantity),
        quarantineQuantity: asNumber(balance.quarantineQuantity),
      }))
    );
  }
  return balances;
}

async function loadMovements(
  prisma: StockReader,
  itemIds: readonly string[],
  warehouseIds: readonly string[] | null
): Promise<NomusStockMovementSnapshot[]> {
  if (itemIds.length === 0) return [];
  if (warehouseIds && warehouseIds.length === 0) return [];
  const movements: NomusStockMovementSnapshot[] = [];
  const movementSelect = {
    id: true,
    itemId: true,
    movementType: true,
    sourceWarehouseId: true,
    destinationWarehouseId: true,
    sourceLocationId: true,
    destinationLocationId: true,
    reversedMovementId: true,
    quantity: true,
    unit: true,
    evidenceRef: true,
    documentNumber: true,
    reason: true,
    movementDate: true,
  } as const;
  for (const chunk of chunks(itemIds, 500)) {
    const found = await prisma.inventoryMovement.findMany({
      where: {
        itemId: { in: [...chunk] },
        ...(warehouseIds
          ? {
              OR: [
                { destinationWarehouseId: { in: [...warehouseIds] } },
                { sourceWarehouseId: { in: [...warehouseIds] } },
              ],
            }
          : {}),
      },
      select: movementSelect,
    });
    movements.push(...found.map(mapMovement));
  }
  const initialIds = movements
    .filter((movement) => movement.movementType === "INITIAL_BALANCE")
    .map((movement) => movement.id);
  for (const chunk of chunks(initialIds, 500)) {
    if (chunk.length === 0) continue;
    const reversals = await prisma.inventoryMovement.findMany({
      where: { movementType: "REVERSAL", reversedMovementId: { in: [...chunk] } },
      select: movementSelect,
    });
    movements.push(...reversals.map(mapMovement));
  }
  return [...new Map(movements.map((movement) => [movement.id, movement])).values()];
}

function mapMovement(movement: {
  id: string;
  itemId: string;
  movementType: string;
  sourceWarehouseId: string | null;
  destinationWarehouseId: string | null;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  reversedMovementId: string | null;
  quantity: { toString(): string } | number;
  unit: string;
  evidenceRef: string | null;
  documentNumber: string | null;
  reason: string;
  movementDate: Date;
}): NomusStockMovementSnapshot {
  return {
    id: movement.id,
    itemId: movement.itemId,
    movementType: movement.movementType,
    sourceWarehouseId: movement.sourceWarehouseId,
    destinationWarehouseId: movement.destinationWarehouseId,
    sourceLocationId: movement.sourceLocationId,
    destinationLocationId: movement.destinationLocationId,
    reversedMovementId: movement.reversedMovementId,
    quantity: asNumber(movement.quantity),
    unit: movement.unit,
    evidenceRef: movement.evidenceRef,
    documentNumber: movement.documentNumber,
    reason: movement.reason,
    movementDate: movement.movementDate.toISOString(),
  };
}

function readStableSheet(filePath: string, requestedSheet: string | null) {
  const resolvedFile = path.resolve(filePath);
  const firstRead = readFileSync(resolvedFile);
  const hashBefore = createHash("sha256").update(firstRead).digest("hex");
  const workbook = XLSX.read(firstRead, { type: "buffer", cellDates: true });
  const secondRead = readFileSync(resolvedFile);
  const hashAfter = createHash("sha256").update(secondRead).digest("hex");
  assertNomusStockFileStable(hashBefore, hashAfter);
  const sheetName = requestedSheet ?? workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new NomusStockPreviewError(
      `Aba "${requestedSheet ?? ""}" não encontrada. Abas: ${workbook.SheetNames.join(", ") || "(nenhuma)"}.`
    );
  }
  const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
  const header = locateNomusStockHeaders(matrix, sheetName);
  const sourceRows = readNomusStockRows(matrix, header);
  return { resolvedFile, sha256: hashBefore, matrix, header, sourceRows };
}

async function loadCatalog(prisma: StockReader, skus: readonly string[]) {
  const products = await loadProducts(prisma, skus);
  const items = await loadItems(
    prisma,
    skus,
    products.map((product) => product.id)
  );
  const warehouses = await loadWarehouses(prisma);
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  const itemIds = items.map((item) => item.id);
  const balances = await loadBalances(prisma, itemIds, warehouseIds);
  const movements = await loadMovements(prisma, itemIds, warehouseIds);
  return { products, items, warehouses, balances, movements };
}

async function runPreview(argv: readonly string[]): Promise<void> {
  const filePath = argumentValue(argv, "file");
  if (!filePath) {
    throw new NomusStockPreviewError("Informe o arquivo com --file=/caminho/arquivo.xls. Nenhum dado foi gravado.");
  }
  const sheet = readStableSheet(filePath, argumentValue(argv, "sheet"));
  const skus = [...new Set(sheet.sourceRows.map((row) => row.sku.trim()).filter(Boolean))];
  let catalog = {
    products: [] as Awaited<ReturnType<typeof loadProducts>>,
    items: [] as Awaited<ReturnType<typeof loadItems>>,
    warehouses: [] as Awaited<ReturnType<typeof loadWarehouses>>,
    balances: [] as Awaited<ReturnType<typeof loadBalances>>,
    movements: [] as Awaited<ReturnType<typeof loadMovements>>,
  };
  if (skus.length > 0) {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new NomusStockPreviewError(
        "DATABASE_URL ausente. O preview precisa ler Product, InventoryItem, almoxarifado, saldo e movimento. Nada foi gravado."
      );
    }
    const prisma = new PrismaClient();
    try {
      catalog = await loadCatalog(prisma, skus);
    } finally {
      await prisma.$disconnect();
    }
  }
  const preview = classifyNomusStockPreview({ sourceRows: sheet.sourceRows, ...catalog });
  const generatedAt = new Date().toISOString();
  const report = formatNomusStockPreviewReport({
    filePath: sheet.resolvedFile,
    sha256: sheet.sha256,
    generatedAt,
    header: sheet.header,
    summary: preview.summary,
  });
  const outDir = argumentValue(argv, "out") ? path.resolve(argumentValue(argv, "out") as string) : os.tmpdir();
  const csvPath = path.join(outDir, "nomus-stock-initial-preview.csv");
  const jsonPath = path.join(outDir, "nomus-stock-initial-preview.json");
  writeFileSync(csvPath, renderNomusStockPreviewCsv(preview.rows), "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        file: sheet.resolvedFile,
        sha256: sheet.sha256,
        generatedAt,
        sheet: sheet.header.sheetName,
        headerRowNumber: sheet.header.headerRowNumber,
        physicalQuantityHeader: sheet.header.physicalQuantityHeader,
        columns: sheet.header.columns,
        summary: preview.summary,
        rows: preview.rows,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(report);
  console.log(`csv: ${csvPath}`);
  console.log(`json: ${jsonPath}`);
}

async function runApply(argv: readonly string[]): Promise<void> {
  const filePath = argumentValue(argv, "file");
  const actorUserId = argumentValue(argv, "actorUserId");
  assertNomusStockApplyRequest({
    confirm: argumentValue(argv, "confirm"),
    actorUserId,
    filePath,
  });
  const sheet = readStableSheet(filePath as string, argumentValue(argv, "sheet"));
  const asOf = resolveNomusStockAsOf({
    matrix: sheet.matrix,
    headerRowNumber: sheet.header.headerRowNumber,
    asOfArg: argumentValue(argv, "asOf"),
  });
  if (!process.env.DATABASE_URL?.trim()) {
    throw new NomusStockPreviewError("DATABASE_URL ausente. APPLY foi interrompido. Nada foi gravado.");
  }
  const prisma = new PrismaClient();
  try {
    const actorRow = await prisma.appUser.findUnique({
      where: { id: (actorUserId as string).trim() },
      select: { id: true, isActive: true, role: true, permissions: true },
    });
    if (!actorRow?.isActive) {
      throw new NomusStockPreviewError("Responsável inexistente ou inativo. APPLY foi interrompido. Nada foi gravado.");
    }
    const actor: NomusStockApplyActor = {
      id: actorRow.id,
      role: actorRow.role,
      isActive: actorRow.isActive,
      permissions: actorRow.permissions,
    };
    const skus = [...new Set(sheet.sourceRows.map((row) => row.sku.trim()).filter(Boolean))];
    const catalog = await loadCatalog(prisma, skus);
    const preview = classifyNomusStockPreview({ sourceRows: sheet.sourceRows, ...catalog });
    const sourceFileName = path.basename(sheet.resolvedFile);
    const result = await executeNomusStockApply({
      rows: preview.rows,
      sourceRows: sheet.sourceRows,
      movements: catalog.movements,
      warehouses: catalog.warehouses,
      sha256: sheet.sha256,
      sourceFileName,
      asOf,
      actor,
      ports: {
        transaction: (work) => prisma.$transaction((tx) => work(applyTx(tx))),
        postInitialBalance: async (input) => {
          const posted = await createInitialInventoryBalance(
            prisma,
            {
              itemId: input.itemId,
              warehouseId: input.warehouseId,
              locationId: input.locationId,
              quantity: input.quantity,
              countDate: input.countDate,
              responsibleUserId: input.responsibleUserId,
              justification: input.justification,
              evidenceRef: input.evidenceRef,
              documentNumber: input.documentNumber,
              notes: input.notes,
              unitCost: input.unitCost,
              unit: input.unit,
            },
            { userId: actor.id, permissions: input.permissions }
          );
          return {
            movementId: posted.movement.id,
            idempotent: posted.idempotent === true,
            quantity: Number(posted.movement.quantity),
          };
        },
      },
    });
    const outDir = argumentValue(argv, "out") ? path.resolve(argumentValue(argv, "out") as string) : os.tmpdir();
    const csvPath = path.join(outDir, "nomus-stock-initial-apply.csv");
    const jsonPath = path.join(outDir, "nomus-stock-initial-apply.json");
    writeFileSync(csvPath, renderNomusStockApplyCsv(result.lines), "utf8");
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          sourceFileName,
          sha256: sheet.sha256,
          asOf,
          generatedAt: new Date().toISOString(),
          appliedItemsCreated: result.appliedItemsCreated,
          appliedInitialBalances: result.appliedInitialBalances,
          idempotent: result.idempotent,
          skipped: result.skipped,
          blocked: result.blocked,
          failed: result.failed,
          lines: result.lines,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log("=== NOMUS STOCK INITIAL LOAD APPLY ===");
    console.log(`arquivo: ${sourceFileName}`);
    console.log(`sha256: ${sheet.sha256}`);
    console.log(`asOf: ${asOf}`);
    console.log(`appliedItemsCreated: ${result.appliedItemsCreated}`);
    console.log(`appliedInitialBalances: ${result.appliedInitialBalances}`);
    console.log(`idempotent: ${result.idempotent}`);
    console.log(`skipped: ${result.skipped}`);
    console.log(`blocked: ${result.blocked}`);
    console.log(`failed: ${result.failed}`);
    console.log(`csv: ${csvPath}`);
    console.log(`json: ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

function applyTx(tx: Prisma.TransactionClient): NomusStockApplyTx {
  return {
    reloadSku: async (sku) => loadCatalog(tx, [sku]),
    createItem: async (data: NomusStockNewItemData) => {
      try {
        return await tx.inventoryItem.create({
          data: {
            code: data.code,
            description: data.description,
            itemType: data.itemType,
            unit: data.unit,
            status: data.status,
            controlsStock: data.controlsStock,
            controlsLocation: data.controlsLocation,
            productId: data.productId,
            nomusProductCode: data.nomusProductCode,
            nomusProductId: data.nomusProductId,
            defaultWarehouseId: data.defaultWarehouseId,
            createdByUserId: data.createdByUserId,
            notes: data.notes,
          },
          select: { id: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new NomusStockItemCodeTakenError();
        }
        throw error;
      }
    },
  };
}

async function runVerify(argv: readonly string[]): Promise<void> {
  if (argv.some((token) => token === "apply" || token === "--apply" || token.startsWith("--apply="))) {
    throw new NomusStockPreviewError("VERIFY não grava e não aceita apply. Nada foi gravado.");
  }
  const filePath = argumentValue(argv, "file");
  if (!filePath) {
    throw new NomusStockPreviewError("Informe o arquivo com --file=/caminho/arquivo.xls. Nada foi gravado.");
  }
  const sheet = readStableSheet(filePath, argumentValue(argv, "sheet"));
  const skus = [...new Set(sheet.sourceRows.map((row) => row.sku.trim()).filter(Boolean))];
  if (!process.env.DATABASE_URL?.trim()) {
    throw new NomusStockPreviewError("DATABASE_URL ausente. VERIFY foi interrompido. Nada foi gravado.");
  }
  const prisma = new PrismaClient();
  try {
    const catalog = skus.length > 0
      ? await loadCatalog(prisma, skus)
      : {
          products: [],
          items: [],
          warehouses: await loadWarehouses(prisma),
          balances: [],
          movements: [],
        };
    const itemIds = catalog.items.map((item) => item.id);
    const balances = await loadBalances(prisma, itemIds, null);
    const movements = await loadMovements(prisma, itemIds, null);
    const result = verifyNomusStockInitialLoad({
      sourceRows: sheet.sourceRows,
      products: catalog.products,
      items: catalog.items,
      warehouses: catalog.warehouses,
      balances,
      movements,
    });
    const sourceFileName = path.basename(sheet.resolvedFile);
    const outDir = argumentValue(argv, "out") ? path.resolve(argumentValue(argv, "out") as string) : os.tmpdir();
    const csvPath = path.join(outDir, "nomus-stock-initial-verify.csv");
    const jsonPath = path.join(outDir, "nomus-stock-initial-verify.json");
    writeFileSync(csvPath, renderNomusStockVerifyCsv(result.lines), "utf8");
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          sourceFileName,
          sha256: sheet.sha256,
          generatedAt: new Date().toISOString(),
          analyzedSkus: result.analyzedSkus,
          counts: result.counts,
          totalOk: result.totalOk,
          totalError: result.totalError,
          totalReview: result.totalReview,
          exitCode: result.exitCode,
          globals: result.globals,
          lines: result.lines,
        },
        null,
        2
      ),
      "utf8"
    );
    console.log(formatNomusStockVerifyReport({ sourceFileName, sha256: sheet.sha256, result }));
    console.log(`csv: ${csvPath}`);
    console.log(`json: ${jsonPath}`);
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const commandToken = argv.find((token) => !token.startsWith("-")) ?? null;
  const wantsApply = argv.some((token) => token === "--apply" || token.startsWith("--apply="));
  if (commandToken === "apply" || wantsApply) {
    if (commandToken === "preview" || commandToken === "verify") {
      throw new NomusStockPreviewError(
        "Preview e verify não gravam. APPLY exige o comando apply, --actorUserId e --confirm=NOMUS_INITIAL_STOCK_LOAD."
      );
    }
    await runApply(argv);
    return;
  }
  if (commandToken === "verify") {
    await runVerify(argv);
    return;
  }
  assertNomusStockPreviewCommand(argv);
  if (commandToken && commandToken !== "preview") {
    throw new NomusStockPreviewError(`Comando "${commandToken}" não existe. Nada foi gravado.`);
  }
  await runPreview(argv);
}

main().catch((error: unknown) => {
  if (error instanceof NomusStockPreviewError) {
    console.error(error.message);
    if (error.headersFound.length > 0) {
      console.error(`Cabeçalhos vistos: ${error.headersFound.join(" | ")}`);
    }
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

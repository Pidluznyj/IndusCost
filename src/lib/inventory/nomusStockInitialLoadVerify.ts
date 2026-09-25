/**
 * Verificação read-only da carga inicial Nomus.
 * Compara o relatório com Product, InventoryItem e a projeção do ledger.
 * Não cria, atualiza nem apaga saldo, movimento, item, Product ou Material.
 */
import {
  assertMaterializedMatchesLedger,
  projectBalancesFromLedger,
  type InventoryLedgerMovementFact,
} from "./inventoryLedgerProjection.js";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";
import {
  classifyNomusStockPreview,
  NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE,
  type NomusStockBalanceSnapshot,
  type NomusStockItemSnapshot,
  type NomusStockMovementSnapshot,
  type NomusStockPreviewRow,
  type NomusStockProductSnapshot,
  type NomusStockSourceRow,
  type NomusStockWarehouseSnapshot,
} from "./nomusStockInitialLoadPreview.js";
import {
  emptyInventoryBalance,
  type InventoryBalanceSnapshot,
  type InventoryMovementType,
} from "./inventoryTypes.js";

export const NOMUS_STOCK_VERIFY_STATUSES = [
  "MATCH_OK",
  "BALANCE_MISMATCH",
  "ITEM_MISSING",
  "ITEM_IDENTITY_MISMATCH",
  "ITEM_TYPE_MISMATCH",
  "UNIT_MISMATCH",
  "WAREHOUSE_MISMATCH",
  "INITIAL_BALANCE_MISSING",
  "INITIAL_BALANCE_DUPLICATE",
  "UNEXPECTED_LEDGER",
  "LEDGER_DIVERGENCE",
  "NOT_APPLICABLE",
  "NEGATIVE_SOURCE_REVIEW",
  "AMBIGUOUS_SOURCE_REVIEW",
] as const;

export type NomusStockVerifyStatus = (typeof NOMUS_STOCK_VERIFY_STATUSES)[number];

const FATAL_STATUSES = new Set<NomusStockVerifyStatus>([
  "BALANCE_MISMATCH",
  "ITEM_MISSING",
  "ITEM_IDENTITY_MISMATCH",
  "ITEM_TYPE_MISMATCH",
  "UNIT_MISMATCH",
  "WAREHOUSE_MISMATCH",
  "INITIAL_BALANCE_MISSING",
  "INITIAL_BALANCE_DUPLICATE",
  "UNEXPECTED_LEDGER",
  "LEDGER_DIVERGENCE",
]);

const REVIEW_STATUSES = new Set<NomusStockVerifyStatus>([
  "NOT_APPLICABLE",
  "NEGATIVE_SOURCE_REVIEW",
  "AMBIGUOUS_SOURCE_REVIEW",
]);

export type NomusStockVerifyLine = {
  sku: string;
  nomusQuantity: number | null;
  productType: string;
  inventoryItemId: string;
  itemType: string;
  warehouse: string;
  physicalQuantity: number | null;
  availableQuantity: number | null;
  difference: number | null;
  initialBalanceCount: number;
  movementId: string;
  documentNumber: string;
  evidenceRef: string;
  verificationStatus: NomusStockVerifyStatus;
  reason: string;
  fatal: boolean;
};

export type NomusStockVerifyResult = {
  analyzedSkus: number;
  counts: Record<NomusStockVerifyStatus, number>;
  totalOk: number;
  totalError: number;
  totalReview: number;
  exitCode: 0 | 1;
  lines: NomusStockVerifyLine[];
  globals: {
    materialLinks: number;
    wrongWarehouseInitialBalances: number;
    negativeApplied: number;
    ambiguousApplied: number;
    duplicateActiveInitialBalances: number;
    ledgerMismatches: number;
  };
};

const ENTRY_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PURCHASE_RECEIPT",
  "PRODUCTION_ENTRY",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
  "INITIAL_BALANCE",
]);

function skuKey(sku: string): string {
  return sku.trim().toLocaleUpperCase("pt-BR");
}

function sameCode(left: string | null | undefined, right: string): boolean {
  return skuKey(left ?? "") === skuKey(right);
}

function isZero(value: number): boolean {
  return Math.abs(value) < 5e-7;
}

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function emptyCounts(): Record<NomusStockVerifyStatus, number> {
  return Object.fromEntries(NOMUS_STOCK_VERIFY_STATUSES.map((status) => [status, 0])) as Record<
    NomusStockVerifyStatus,
    number
  >;
}

function expectedWarehouseCode(productType: string): string {
  if (productType === "PRODUCT") return NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.PRODUCT;
  if (productType === "COMPONENT") return NOMUS_STOCK_WAREHOUSE_BY_PRODUCT_TYPE.COMPONENT;
  return "";
}

function expectedItemType(productType: string): string {
  if (productType === "PRODUCT") return "FINISHED_PRODUCT";
  if (productType === "COMPONENT") return "COMPONENT";
  return "";
}

function warehouseByCode(
  warehouses: readonly NomusStockWarehouseSnapshot[],
  code: string
): NomusStockWarehouseSnapshot | null {
  const matches = warehouses.filter((warehouse) => sameCode(warehouse.code, code));
  return matches.length === 1 ? matches[0]! : null;
}

function reversedIds(movements: readonly NomusStockMovementSnapshot[]): Set<string> {
  return new Set(
    movements
      .filter((movement) => movement.movementType === "REVERSAL" && movement.reversedMovementId)
      .map((movement) => movement.reversedMovementId as string)
  );
}

function activeInitialBalances(
  itemId: string,
  movements: readonly NomusStockMovementSnapshot[]
): NomusStockMovementSnapshot[] {
  const reversed = reversedIds(movements);
  return movements.filter(
    (movement) =>
      movement.itemId === itemId &&
      movement.movementType === "INITIAL_BALANCE" &&
      !reversed.has(movement.id)
  );
}

function sumBalances(rows: readonly NomusStockBalanceSnapshot[]): InventoryBalanceSnapshot {
  return rows.reduce<InventoryBalanceSnapshot>(
    (sum, row) => ({
      physicalQuantity: sum.physicalQuantity + row.physicalQuantity,
      availableQuantity: sum.availableQuantity + row.availableQuantity,
      reservedQuantity: sum.reservedQuantity + (row.reservedQuantity ?? 0),
      blockedQuantity: sum.blockedQuantity + (row.blockedQuantity ?? 0),
      quarantineQuantity: sum.quarantineQuantity + (row.quarantineQuantity ?? 0),
    }),
    emptyInventoryBalance()
  );
}

function toLedgerFact(
  movement: NomusStockMovementSnapshot,
  movements: readonly NomusStockMovementSnapshot[]
): InventoryLedgerMovementFact {
  const movementType = movement.movementType as InventoryMovementType;
  const isEntry = ENTRY_TYPES.has(movementType);
  const warehouseId = isEntry
    ? (movement.destinationWarehouseId ?? movement.sourceWarehouseId)
    : (movement.sourceWarehouseId ?? movement.destinationWarehouseId);
  if (!warehouseId) {
    throw new Error(`Movimento ${movement.id} sem almoxarifado.`);
  }
  const locationId = isEntry
    ? (movement.destinationLocationId ?? movement.sourceLocationId ?? null)
    : (movement.sourceLocationId ?? movement.destinationLocationId ?? null);
  const original = movement.reversedMovementId
    ? movements.find((candidate) => candidate.id === movement.reversedMovementId)
    : null;
  return {
    id: movement.id,
    movementType,
    quantity: movement.quantity ?? 0,
    warehouseId,
    locationId,
    destinationWarehouseId: movement.destinationWarehouseId,
    destinationLocationId: movement.destinationLocationId ?? null,
    originalMovementType: (original?.movementType as InventoryMovementType) ?? null,
    reversedMovementId: movement.reversedMovementId,
    unit: movement.unit ?? "",
    movementDate: movement.movementDate ?? "1970-01-01T00:00:00.000Z",
  };
}

function ledgerAgrees(
  itemId: string,
  warehouseId: string,
  balances: readonly NomusStockBalanceSnapshot[],
  movements: readonly NomusStockMovementSnapshot[]
): { ok: boolean; reason: string } {
  const itemMovements = movements.filter((movement) => movement.itemId === itemId);
  if (itemMovements.some((movement) => movement.quantity == null)) {
    return { ok: false, reason: "Movimento sem quantidade. A projeção do ledger não foi fechada." };
  }
  let projected;
  try {
    projected = projectBalancesFromLedger(itemMovements.map((movement) => toLedgerFact(movement, itemMovements)));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const projectedSum = emptyInventoryBalance();
  for (const scope of projected.values()) {
    if (scope.warehouseId !== warehouseId) continue;
    projectedSum.physicalQuantity += scope.physicalQuantity;
    projectedSum.availableQuantity += scope.availableQuantity;
    projectedSum.reservedQuantity += scope.reservedQuantity;
    projectedSum.blockedQuantity += scope.blockedQuantity;
    projectedSum.quarantineQuantity += scope.quarantineQuantity;
  }
  const materialized = sumBalances(balances.filter((row) => row.itemId === itemId && row.warehouseId === warehouseId));
  const rounded = {
    physicalQuantity: roundQuantity(materialized.physicalQuantity),
    availableQuantity: roundQuantity(materialized.availableQuantity),
    reservedQuantity: roundQuantity(materialized.reservedQuantity),
    blockedQuantity: roundQuantity(materialized.blockedQuantity),
    quarantineQuantity: roundQuantity(materialized.quarantineQuantity),
  };
  const projectedRounded = {
    physicalQuantity: roundQuantity(projectedSum.physicalQuantity),
    availableQuantity: roundQuantity(projectedSum.availableQuantity),
    reservedQuantity: roundQuantity(projectedSum.reservedQuantity),
    blockedQuantity: roundQuantity(projectedSum.blockedQuantity),
    quarantineQuantity: roundQuantity(projectedSum.quarantineQuantity),
  };
  try {
    assertMaterializedMatchesLedger(rounded, projectedRounded);
    return { ok: true, reason: "" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function lineShell(
  row: NomusStockPreviewRow,
  status: NomusStockVerifyStatus,
  reason: string,
  extra?: Partial<NomusStockVerifyLine>
): NomusStockVerifyLine {
  const fatal = FATAL_STATUSES.has(status) || extra?.fatal === true;
  return {
    sku: row.sku,
    nomusQuantity: extra?.nomusQuantity !== undefined ? extra.nomusQuantity : row.nomusQuantity,
    productType: extra?.productType ?? row.productType,
    inventoryItemId: extra?.inventoryItemId ?? row.inventoryItemId,
    itemType: extra?.itemType ?? row.inventoryItemType,
    warehouse: extra?.warehouse ?? row.warehouseCode,
    physicalQuantity: extra?.physicalQuantity ?? row.physicalQuantity,
    availableQuantity: extra?.availableQuantity ?? row.availableQuantity,
    difference: extra?.difference ?? row.difference,
    initialBalanceCount: extra?.initialBalanceCount ?? row.initialBalanceCount,
    movementId: extra?.movementId ?? "",
    documentNumber: extra?.documentNumber ?? "",
    evidenceRef: extra?.evidenceRef ?? "",
    verificationStatus: status,
    reason,
    fatal,
  };
}

function appliedSomewhere(
  itemIds: readonly string[],
  movements: readonly NomusStockMovementSnapshot[]
): boolean {
  return itemIds.some((itemId) => activeInitialBalances(itemId, movements).length > 0);
}

export function verifyNomusStockInitialLoad(input: {
  sourceRows: readonly NomusStockSourceRow[];
  products: readonly NomusStockProductSnapshot[];
  items: readonly NomusStockItemSnapshot[];
  warehouses: readonly NomusStockWarehouseSnapshot[];
  balances: readonly NomusStockBalanceSnapshot[];
  movements: readonly NomusStockMovementSnapshot[];
}): NomusStockVerifyResult {
  const preview = classifyNomusStockPreview(input);
  const groups = new Map<string, NomusStockPreviewRow[]>();
  for (const row of preview.rows) {
    const key = row.sku ? skuKey(row.sku) : `__ROW__:${row.sourceRows.join("-")}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const lines: NomusStockVerifyLine[] = [];
  for (const bucket of groups.values()) {
    const ambiguous = bucket.some((row) => row.classification === "AMBIGUOUS_REPORT_IDENTITY");
    const sample = bucket[0]!;
    if (ambiguous) {
      const linked = input.items.filter((item) => sameCode(item.code, sample.sku) || sameCode(item.nomusProductCode, sample.sku));
      const applied = appliedSomewhere(linked.map((item) => item.id), input.movements);
      lines.push(
        lineShell(sample, "AMBIGUOUS_SOURCE_REVIEW", sample.reason, {
          fatal: applied,
          nomusQuantity: null,
        })
      );
      continue;
    }
    lines.push(verifyPreviewRow(sample, input));
  }

  const counts = emptyCounts();
  for (const line of lines) counts[line.verificationStatus] += 1;
  const totalOk = counts.MATCH_OK;
  const totalReview = lines.filter((line) => REVIEW_STATUSES.has(line.verificationStatus) && !line.fatal).length;
  const totalError = lines.length - totalOk - totalReview;
  return {
    analyzedSkus: lines.length,
    counts,
    totalOk,
    totalError,
    totalReview,
    exitCode: lines.some((line) => line.fatal) ? 1 : 0,
    lines,
    globals: {
      materialLinks: lines.filter((line) => line.verificationStatus === "ITEM_IDENTITY_MISMATCH").length,
      wrongWarehouseInitialBalances: lines.filter((line) => line.verificationStatus === "WAREHOUSE_MISMATCH").length,
      negativeApplied: lines.filter((line) => line.verificationStatus === "NEGATIVE_SOURCE_REVIEW" && line.fatal).length,
      ambiguousApplied: lines.filter((line) => line.verificationStatus === "AMBIGUOUS_SOURCE_REVIEW" && line.fatal).length,
      duplicateActiveInitialBalances: lines.filter((line) => line.verificationStatus === "INITIAL_BALANCE_DUPLICATE").length,
      ledgerMismatches: lines.filter((line) => line.verificationStatus === "LEDGER_DIVERGENCE").length,
    },
  };
}

function verifyPreviewRow(
  row: NomusStockPreviewRow,
  input: {
    items: readonly NomusStockItemSnapshot[];
    warehouses: readonly NomusStockWarehouseSnapshot[];
    balances: readonly NomusStockBalanceSnapshot[];
    movements: readonly NomusStockMovementSnapshot[];
  }
): NomusStockVerifyLine {
  if (row.classification === "NEGATIVE_STOCK_REVIEW") {
    const linked = input.items.filter((item) => sameCode(item.code, row.sku) || (row.productId && item.productId === row.productId));
    const applied = appliedSomewhere(linked.map((item) => item.id), input.movements);
    return lineShell(row, "NEGATIVE_SOURCE_REVIEW", row.reason, { fatal: applied });
  }
  if (
    row.classification === "ZERO_BALANCE_NO_ACTION" ||
    row.classification === "PRODUCT_NOT_FOUND" ||
    row.classification === "OUT_OF_SCOPE_PRODUCT_TYPE" ||
    row.classification === "INACTIVE_PRODUCT_REVIEW" ||
    row.classification === "QUANTITY_UNPARSEABLE" ||
    row.classification === "SKU_MISSING" ||
    row.classification === "WAREHOUSE_UNAVAILABLE"
  ) {
    const linked = input.items.filter((item) => sameCode(item.code, row.sku) || (row.productId && item.productId === row.productId));
    const applied = appliedSomewhere(linked.map((item) => item.id), input.movements);
    return lineShell(row, "NOT_APPLICABLE", row.reason, { fatal: applied });
  }
  if (row.classification === "INVENTORY_ITEM_IDENTITY_CONFLICT") {
    return lineShell(row, "ITEM_IDENTITY_MISMATCH", row.reason);
  }
  if (row.classification === "INVENTORY_ITEM_TYPE_MISMATCH") {
    return lineShell(row, "ITEM_TYPE_MISMATCH", row.reason);
  }
  if (row.classification === "UNIT_MISMATCH" || row.classification === "UNIT_MISSING") {
    return lineShell(row, "UNIT_MISMATCH", row.reason);
  }

  const warehouseCode = expectedWarehouseCode(row.productType);
  const warehouse = warehouseByCode(input.warehouses, warehouseCode);
  if (!row.productId || !warehouse) {
    return lineShell(row, "WAREHOUSE_MISMATCH", `Almoxarifado ${warehouseCode || "destino"} indisponível.`, {
      warehouse: warehouseCode,
    });
  }
  const item = input.items.find((candidate) => candidate.id === row.inventoryItemId) ??
    input.items.find((candidate) => candidate.productId === row.productId && !candidate.materialId);
  if (!item) {
    return lineShell(row, "ITEM_MISSING", "Não há InventoryItem vinculado a este Product.", { warehouse: warehouse.code });
  }
  if (item.materialId || (item.productId && item.productId !== row.productId)) {
    return lineShell(row, "ITEM_IDENTITY_MISMATCH", "InventoryItem ligado a matéria-prima ou a outro Product.", {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
    });
  }
  if (item.itemType !== expectedItemType(row.productType)) {
    return lineShell(row, "ITEM_TYPE_MISMATCH", `itemType ${item.itemType} não corresponde a ${row.productType}.`, {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
    });
  }
  if (!row.unitNomus || !unitsCompatible(item.unit, row.unitNomus)) {
    return lineShell(row, "UNIT_MISMATCH", `Unidade do item (${item.unit}) difere da U.M. Nomus (${row.unitNomus}).`, {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
    });
  }

  const initials = activeInitialBalances(item.id, input.movements);
  const inWarehouse = initials.filter((movement) => movement.destinationWarehouseId === warehouse.id);
  const elsewhere = initials.filter((movement) => movement.destinationWarehouseId !== warehouse.id);
  if (elsewhere.length > 0) {
    return lineShell(row, "WAREHOUSE_MISMATCH", "Há INITIAL_BALANCE ativo fora do almoxarifado desta carga.", {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
      initialBalanceCount: initials.length,
      movementId: elsewhere[0]?.id ?? "",
    });
  }
  if (inWarehouse.length === 0) {
    return lineShell(row, "INITIAL_BALANCE_MISSING", "Não há INITIAL_BALANCE ativo no almoxarifado de destino.", {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
      initialBalanceCount: 0,
    });
  }
  if (inWarehouse.length > 1) {
    return lineShell(row, "INITIAL_BALANCE_DUPLICATE", "Há mais de um INITIAL_BALANCE ativo no mesmo item e almoxarifado.", {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
      initialBalanceCount: inWarehouse.length,
      movementId: inWarehouse.map((movement) => movement.id).join("|"),
    });
  }

  const initial = inWarehouse[0]!;
  const itemMovements = input.movements.filter(
    (movement) =>
      movement.itemId === item.id &&
      (movement.destinationWarehouseId === warehouse.id || movement.sourceWarehouseId === warehouse.id)
  );
  if (itemMovements.length !== 1 || itemMovements[0]?.id !== initial.id) {
    return lineShell(row, "UNEXPECTED_LEDGER", "O almoxarifado tem movimento além do saldo inicial desta carga.", {
      inventoryItemId: item.id,
      itemType: item.itemType,
      warehouse: warehouse.code,
      initialBalanceCount: 1,
      movementId: initial.id,
      documentNumber: initial.documentNumber ?? "",
      evidenceRef: initial.evidenceRef ?? "",
    });
  }

  const materialized = sumBalances(
    input.balances.filter((balance) => balance.itemId === item.id && balance.warehouseId === warehouse.id)
  );
  const nomusQuantity = row.nomusQuantity ?? 0;
  const difference = roundQuantity(nomusQuantity - materialized.physicalQuantity);
  const holds = materialized.reservedQuantity + materialized.blockedQuantity + materialized.quarantineQuantity;
  const evidence = {
    inventoryItemId: item.id,
    itemType: item.itemType,
    warehouse: warehouse.code,
    physicalQuantity: roundQuantity(materialized.physicalQuantity),
    availableQuantity: roundQuantity(materialized.availableQuantity),
    difference,
    initialBalanceCount: 1,
    movementId: initial.id,
    documentNumber: initial.documentNumber ?? "",
    evidenceRef: initial.evidenceRef ?? "",
  };
  if (!isZero(difference)) {
    return lineShell(row, "BALANCE_MISMATCH", "Quantidade Nomus difere do saldo físico.", evidence);
  }
  if (isZero(holds) && !isZero(materialized.availableQuantity - materialized.physicalQuantity)) {
    return lineShell(
      row,
      "BALANCE_MISMATCH",
      "Sem reserva, bloqueio ou quarentena, o disponível deveria igualar o físico.",
      evidence
    );
  }
  const ledger = ledgerAgrees(item.id, warehouse.id, input.balances, input.movements);
  if (!ledger.ok) {
    return lineShell(row, "LEDGER_DIVERGENCE", ledger.reason, evidence);
  }
  return lineShell(row, "MATCH_OK", "Saldo físico confere com o Nomus e com o ledger.", evidence);
}

export function renderNomusStockVerifyCsv(lines: readonly NomusStockVerifyLine[]): string {
  const columns: (keyof NomusStockVerifyLine)[] = [
    "sku",
    "nomusQuantity",
    "productType",
    "inventoryItemId",
    "itemType",
    "warehouse",
    "physicalQuantity",
    "availableQuantity",
    "difference",
    "initialBalanceCount",
    "movementId",
    "verificationStatus",
    "reason",
  ];
  const escape = (value: unknown) => {
    const text = value == null ? "" : String(value);
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  return [columns.join(","), ...lines.map((line) => columns.map((column) => escape(line[column])).join(","))].join("\n") + "\n";
}

export function formatNomusStockVerifyReport(input: {
  sourceFileName: string;
  sha256: string;
  result: NomusStockVerifyResult;
}): string {
  const counts = input.result.counts;
  return [
    "=== NOMUS INITIAL STOCK VERIFY ===",
    `arquivo: ${input.sourceFileName}`,
    `sha256: ${input.sha256}`,
    "",
    `SKUs analisados: ${input.result.analyzedSkus}`,
    `MATCH_OK: ${counts.MATCH_OK}`,
    `BALANCE_MISMATCH: ${counts.BALANCE_MISMATCH}`,
    `ITEM_MISSING: ${counts.ITEM_MISSING}`,
    `ITEM_IDENTITY_MISMATCH: ${counts.ITEM_IDENTITY_MISMATCH}`,
    `ITEM_TYPE_MISMATCH: ${counts.ITEM_TYPE_MISMATCH}`,
    `UNIT_MISMATCH: ${counts.UNIT_MISMATCH}`,
    `WAREHOUSE_MISMATCH: ${counts.WAREHOUSE_MISMATCH}`,
    `INITIAL_BALANCE_MISSING: ${counts.INITIAL_BALANCE_MISSING}`,
    `INITIAL_BALANCE_DUPLICATE: ${counts.INITIAL_BALANCE_DUPLICATE}`,
    `UNEXPECTED_LEDGER: ${counts.UNEXPECTED_LEDGER}`,
    `LEDGER_DIVERGENCE: ${counts.LEDGER_DIVERGENCE}`,
    `NOT_APPLICABLE: ${counts.NOT_APPLICABLE}`,
    `NEGATIVE_SOURCE_REVIEW: ${counts.NEGATIVE_SOURCE_REVIEW}`,
    `AMBIGUOUS_SOURCE_REVIEW: ${counts.AMBIGUOUS_SOURCE_REVIEW}`,
    "",
    `itens ligados a Material: ${input.result.globals.materialLinks}`,
    `INITIAL_BALANCE em almoxarifado errado: ${input.result.globals.wrongWarehouseInitialBalances}`,
    `negativos aplicados: ${input.result.globals.negativeApplied}`,
    `ambíguos aplicados: ${input.result.globals.ambiguousApplied}`,
    `saldos iniciais ativos duplicados: ${input.result.globals.duplicateActiveInitialBalances}`,
    `divergências de ledger: ${input.result.globals.ledgerMismatches}`,
    "",
    `TOTAL OK: ${input.result.totalOk}`,
    `TOTAL ERROR: ${input.result.totalError}`,
    `TOTAL REVIEW: ${input.result.totalReview}`,
    "",
    "VERIFY só leu Product, InventoryItem, almoxarifado, saldo e movimento.",
  ].join("\n");
}

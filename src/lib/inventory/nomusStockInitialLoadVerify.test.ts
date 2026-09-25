import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  verifyNomusStockInitialLoad,
  type NomusStockVerifyStatus,
} from "./nomusStockInitialLoadVerify.ts";
import type {
  NomusStockBalanceSnapshot,
  NomusStockItemSnapshot,
  NomusStockMovementSnapshot,
  NomusStockProductSnapshot,
  NomusStockSourceRow,
  NomusStockWarehouseSnapshot,
} from "./nomusStockInitialLoadPreview.ts";

const warehouses: NomusStockWarehouseSnapshot[] = [
  { id: "wh-pa", code: "PA", status: "ACTIVE", allowsMovements: true },
  { id: "wh-comp", code: "COMPONENTES", status: "ACTIVE", allowsMovements: true },
];

function source(overrides: Partial<NomusStockSourceRow> = {}): NomusStockSourceRow {
  return {
    sourceRow: 2,
    sku: "622.03AA",
    description: "Peca",
    unit: "PC",
    oursInOurPower: 10,
    oursInThirdPower: null,
    thirdInOurPower: null,
    total: null,
    ...overrides,
  };
}

function product(): NomusStockProductSnapshot {
  return { id: "prod-1", sku: "622.03AA", name: "Peca oficial", type: "PRODUCT", status: "ACTIVE" };
}

function item(overrides: Partial<NomusStockItemSnapshot> = {}): NomusStockItemSnapshot {
  return {
    id: "item-1",
    code: "622.03AA",
    productId: "prod-1",
    materialId: null,
    itemType: "FINISHED_PRODUCT",
    unit: "PC",
    nomusProductCode: "622.03AA",
    ...overrides,
  };
}

function initial(overrides: Partial<NomusStockMovementSnapshot> = {}): NomusStockMovementSnapshot {
  return {
    id: "mov-1",
    itemId: "item-1",
    movementType: "INITIAL_BALANCE",
    sourceWarehouseId: null,
    destinationWarehouseId: "wh-pa",
    reversedMovementId: null,
    quantity: 10,
    unit: "PC",
    evidenceRef: "sha256:abc",
    documentNumber: "RelatorioPosicaoEstoqueEmpresa:2026-09-24",
    movementDate: "2026-09-24T12:00:00.000Z",
    ...overrides,
  };
}

function balance(overrides: Partial<NomusStockBalanceSnapshot> = {}): NomusStockBalanceSnapshot {
  return {
    itemId: "item-1",
    warehouseId: "wh-pa",
    physicalQuantity: 10,
    availableQuantity: 10,
    reservedQuantity: 0,
    blockedQuantity: 0,
    quarantineQuantity: 0,
    locationId: null,
    ...overrides,
  };
}

function verify(input: {
  sourceRows?: NomusStockSourceRow[];
  products?: NomusStockProductSnapshot[];
  items?: NomusStockItemSnapshot[];
  balances?: NomusStockBalanceSnapshot[];
  movements?: NomusStockMovementSnapshot[];
}) {
  return verifyNomusStockInitialLoad({
    sourceRows: input.sourceRows ?? [source()],
    products: input.products ?? [product()],
    items: input.items ?? [item()],
    warehouses,
    balances: input.balances ?? [balance()],
    movements: input.movements ?? [initial()],
  });
}

function status(result: ReturnType<typeof verify>): NomusStockVerifyStatus {
  return result.lines[0]!.verificationStatus;
}

test("match perfeito confere físico, disponível e ledger", () => {
  const result = verify({});
  assert.equal(status(result), "MATCH_OK");
  assert.equal(result.exitCode, 0);
  assert.equal(result.totalOk, 1);
  assert.equal(result.lines[0]?.physicalQuantity, 10);
  assert.equal(result.lines[0]?.availableQuantity, 10);
  assert.equal(result.lines[0]?.difference, 0);
  assert.equal(result.lines[0]?.movementId, "mov-1");
  assert.equal(result.lines[0]?.documentNumber, "RelatorioPosicaoEstoqueEmpresa:2026-09-24");
  assert.equal(result.lines[0]?.evidenceRef, "sha256:abc");
});

test("saldo divergente", () => {
  const result = verify({
    balances: [balance({ physicalQuantity: 4, availableQuantity: 4 })],
    movements: [initial({ quantity: 4 })],
  });
  assert.equal(status(result), "BALANCE_MISMATCH");
  assert.equal(result.lines[0]?.difference, 6);
  assert.equal(result.exitCode, 1);
});

test("warehouse errado", () => {
  const result = verify({
    balances: [balance({ warehouseId: "wh-comp" })],
    movements: [initial({ destinationWarehouseId: "wh-comp" })],
  });
  assert.equal(status(result), "WAREHOUSE_MISMATCH");
  assert.equal(result.exitCode, 1);
  assert.equal(result.globals.wrongWarehouseInitialBalances, 1);
});

test("item inexistente", () => {
  const result = verify({ items: [], balances: [], movements: [] });
  assert.equal(status(result), "ITEM_MISSING");
  assert.equal(result.exitCode, 1);
});

test("initial balance ausente", () => {
  const result = verify({ balances: [], movements: [] });
  assert.equal(status(result), "INITIAL_BALANCE_MISSING");
  assert.equal(result.exitCode, 1);
});

test("initial balance duplicado", () => {
  const result = verify({
    movements: [initial(), initial({ id: "mov-2" })],
  });
  assert.equal(status(result), "INITIAL_BALANCE_DUPLICATE");
  assert.equal(result.exitCode, 1);
  assert.equal(result.globals.duplicateActiveInitialBalances, 1);
});

test("item ligado a material não é aceito", () => {
  const result = verify({
    items: [item({ materialId: "mat-1", itemType: "RAW_MATERIAL", unit: "KG" })],
    balances: [],
    movements: [],
  });
  assert.equal(status(result), "ITEM_IDENTITY_MISMATCH");
  assert.equal(result.exitCode, 1);
  assert.equal(result.globals.materialLinks, 1);
});

test("source negativo não aplicado fica em revisão", () => {
  const result = verify({
    sourceRows: [source({ oursInOurPower: -2 })],
    items: [],
    balances: [],
    movements: [],
  });
  assert.equal(status(result), "NEGATIVE_SOURCE_REVIEW");
  assert.equal(result.lines[0]?.fatal, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.totalReview, 1);
  assert.equal(result.globals.negativeApplied, 0);
});

test("source ambíguo não aplicado fica em revisão", () => {
  const result = verify({
    sourceRows: [
      source({ sourceRow: 2, description: "Corpo A" }),
      source({ sourceRow: 3, description: "Corpo B" }),
    ],
    items: [],
    balances: [],
    movements: [],
  });
  assert.equal(status(result), "AMBIGUOUS_SOURCE_REVIEW");
  assert.equal(result.lines[0]?.fatal, false);
  assert.equal(result.exitCode, 0);
  assert.equal(result.globals.ambiguousApplied, 0);
});

test("verify não executa nenhuma escrita", () => {
  const verifyText = readFileSync(path.join(process.cwd(), "src", "lib", "inventory", "nomusStockInitialLoadVerify.ts"), "utf8");
  const scriptText = readFileSync(path.join(process.cwd(), "scripts", "nomusStockInitialLoad.ts"), "utf8");
  const verifyFn = scriptText.slice(scriptText.indexOf("async function runVerify"), scriptText.indexOf("async function main"));
  assert.doesNotMatch(verifyText, /inventoryBalance\.(create|update|upsert|delete)/);
  assert.doesNotMatch(verifyText, /rebuildInventoryBalances/);
  assert.match(verifyText, /projectBalancesFromLedger/);
  assert.match(verifyText, /assertMaterializedMatchesLedger/);
  assert.doesNotMatch(verifyFn, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/);
  assert.match(verifyFn, /findMany|loadCatalog|loadBalances|loadMovements/);
});
